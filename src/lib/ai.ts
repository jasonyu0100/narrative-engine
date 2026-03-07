import type { NarrativeState, Scene, Arc, Character, Location, Thread, RelationshipEdge, CubeCornerKey, WorldBuildCommit, StorySettings } from '@/types/narrative';
import { resolveEntry, NARRATIVE_CUBE, THREAD_ACTIVE_STATUSES, THREAD_TERMINAL_STATUSES, THREAD_STATUS_LABELS, DEFAULT_STORY_SETTINGS } from '@/types/narrative';

// Build thread lifecycle documentation from canonical status lists
const THREAD_LIFECYCLE_DOC = (() => {
  const activeList = THREAD_ACTIVE_STATUSES.map((s) => `"${s}"`).join(', ');
  const terminalList = THREAD_TERMINAL_STATUSES.map(
    (s) => `"${s}" (${THREAD_STATUS_LABELS[s]})`,
  ).join(', ');
  return `Active statuses: ${activeList}. Terminal/closed statuses: ${terminalList}.`;
})();
import { nextId, nextIds, computeForceSnapshots, computeSwingMagnitudes, detectCubeCorner, movingAverage, FORCE_WINDOW_SIZE, computeEngagementCurve, classifyCurrentPosition } from '@/lib/narrative-utils';
import { apiHeaders } from '@/lib/api-headers';
import { MAX_CONTEXT_SCENES } from '@/lib/constants';

export type WorldExpansion = {
  characters: Character[];
  locations: Location[];
  threads: Thread[];
  relationships: RelationshipEdge[];
};

async function callGenerateStream(
  prompt: string,
  systemPrompt: string,
  onToken: (token: string) => void,
  maxTokens?: number,
  caller = 'callGenerateStream',
): Promise<string> {
  const { logApiCall, updateApiLog } = await import('@/lib/api-logger');
  const logId = logApiCall(caller, prompt.length + (systemPrompt?.length ?? 0), prompt);
  const start = performance.now();

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ prompt, systemPrompt, stream: true, ...(maxTokens ? { maxTokens } : {}) }),
    });
    if (!res.ok) {
      const err = await res.json();
      const message = err.error || 'Generation failed';
      updateApiLog(logId, { status: 'error', error: message, durationMs: Math.round(performance.now() - start) });
      throw new Error(message);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';

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
            const chunk = JSON.parse(trimmed.slice(6));
            const token = chunk.token ?? '';
            if (token) {
              full += token;
              onToken(token);
            }
          } catch {
            // skip malformed chunks
          }
        }
      }
    }

    updateApiLog(logId, {
      status: 'success',
      durationMs: Math.round(performance.now() - start),
      responseLength: full.length,
      responsePreview: full,
    });
    return full;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateApiLog(logId, { status: 'error', error: message, durationMs: Math.round(performance.now() - start) });
    throw err;
  }
}

async function callGenerate(prompt: string, systemPrompt: string, maxTokens?: number, caller = 'callGenerate'): Promise<string> {
  const { logApiCall, updateApiLog } = await import('@/lib/api-logger');
  const logId = logApiCall(caller, prompt.length + (systemPrompt?.length ?? 0), prompt);
  const start = performance.now();

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ prompt, systemPrompt, ...(maxTokens ? { maxTokens } : {}) }),
    });
    if (!res.ok) {
      const err = await res.json();
      const message = err.error || 'Generation failed';
      updateApiLog(logId, { status: 'error', error: message, durationMs: Math.round(performance.now() - start) });
      throw new Error(message);
    }
    const data = await res.json();
    const content = data.content;
    updateApiLog(logId, {
      status: 'success',
      durationMs: Math.round(performance.now() - start),
      responseLength: content.length,
      responsePreview: content,
    });
    return content;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateApiLog(logId, { status: 'error', error: message, durationMs: Math.round(performance.now() - start) });
    throw err;
  }
}

/**
 * Build context from the most recent MAX_CONTEXT_SCENES scenes on the branch.
 * Only entities (characters, locations, threads) referenced within this time
 * horizon are included, and knowledge graphs are filtered to nodes added
 * during the window.
 */
/** Build a prompt block from story settings — returns empty string if all defaults */
function buildStorySettingsBlock(n: NarrativeState): string {
  const s: StorySettings = { ...DEFAULT_STORY_SETTINGS, ...n.storySettings };
  const lines: string[] = [];

  // POV mode
  const povLabels: Record<string, string> = {
    single: 'SINGLE POV — every scene must use the same POV character.',
    dual: 'DUAL POV — alternate between exactly two POV characters across scenes. Each arc should feature both perspectives.',
    ensemble: 'ENSEMBLE POV — rotate POV among the designated characters, giving each meaningful screen time.',
    free: '', // no constraint
  };
  if (s.povMode !== 'free') {
    lines.push(povLabels[s.povMode]);
    if (s.povCharacterIds.length > 0) {
      const names = s.povCharacterIds
        .map((id) => n.characters[id] ? `${n.characters[id].name} (${id})` : id)
        .join(', ');
      lines.push(`Designated POV anchor${s.povCharacterIds.length > 1 ? 's' : ''}: ${names}. Only these characters may appear in the "povId" field.`);
    }
  }

  // Story direction
  if (s.storyDirection.trim()) {
    lines.push(`STORY DIRECTION (high-level north star): ${s.storyDirection.trim()}`);
  }

  if (lines.length === 0) return '';
  return `\nSTORY SETTINGS (these shape all generation — respect them):\n${lines.join('\n')}\n`;
}

export function branchContext(
  n: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): string {
  // Apply time horizon: only the most recent MAX_CONTEXT_SCENES keys
  const allKeysUpToCurrent = resolvedKeys.slice(0, currentIndex + 1);
  const horizonStart = Math.max(0, allKeysUpToCurrent.length - MAX_CONTEXT_SCENES);
  const keysUpToCurrent = allKeysUpToCurrent.slice(horizonStart);
  const skippedCount = horizonStart;

  // Collect entity IDs and knowledge node IDs referenced within the time horizon
  const referencedCharIds = new Set<string>();
  const referencedLocIds = new Set<string>();
  const referencedThreadIds = new Set<string>();
  const horizonKnowledgeNodeIds = new Set<string>();
  for (const k of keysUpToCurrent) {
    const entry = resolveEntry(n, k);
    if (!entry) continue;
    if (entry.kind === 'scene') {
      referencedCharIds.add(entry.povId);
      for (const pid of entry.participantIds) referencedCharIds.add(pid);
      referencedLocIds.add(entry.locationId);
      for (const tm of entry.threadMutations) referencedThreadIds.add(tm.threadId);
      for (const km of entry.knowledgeMutations) {
        referencedCharIds.add(km.characterId);
        horizonKnowledgeNodeIds.add(km.nodeId);
      }
      for (const rm of entry.relationshipMutations) {
        referencedCharIds.add(rm.from);
        referencedCharIds.add(rm.to);
      }
      if (entry.characterMovements) {
        for (const [charId, locId] of Object.entries(entry.characterMovements)) {
          referencedCharIds.add(charId);
          referencedLocIds.add(locId);
        }
      }
    } else if (entry.kind === 'world_build') {
      for (const cid of entry.expansionManifest.characterIds) referencedCharIds.add(cid);
      for (const lid of entry.expansionManifest.locationIds) referencedLocIds.add(lid);
      for (const tid of entry.expansionManifest.threadIds) referencedThreadIds.add(tid);
    }
  }
  // Also include threads that anchor to referenced characters/locations
  for (const t of Object.values(n.threads)) {
    if (referencedThreadIds.has(t.id)) continue;
    for (const anchor of t.anchors) {
      if ((anchor.type === 'character' && referencedCharIds.has(anchor.id)) ||
          (anchor.type === 'location' && referencedLocIds.has(anchor.id))) {
        referencedThreadIds.add(t.id);
        break;
      }
    }
  }
  // Include parent locations of referenced locations
  for (const locId of [...referencedLocIds]) {
    const loc = n.locations[locId];
    if (loc?.parentId && n.locations[loc.parentId]) referencedLocIds.add(loc.parentId);
  }

  // If no scenes exist yet (initial generation), include all entities
  const hasHistory = referencedCharIds.size > 0 || referencedLocIds.size > 0;
  const branchCharacters = hasHistory
    ? Object.values(n.characters).filter((c) => referencedCharIds.has(c.id))
    : Object.values(n.characters);
  const branchLocations = hasHistory
    ? Object.values(n.locations).filter((l) => referencedLocIds.has(l.id))
    : Object.values(n.locations);
  const branchThreads = hasHistory
    ? Object.values(n.threads).filter((t) => referencedThreadIds.has(t.id))
    : Object.values(n.threads);
  const branchRelationships = hasHistory
    ? n.relationships.filter((r) => referencedCharIds.has(r.from) && referencedCharIds.has(r.to))
    : n.relationships;

  // Collect all knowledge node IDs that were ever added via mutations (across full history)
  // so we can distinguish original/base nodes from mutation-added ones
  const allMutationNodeIds = new Set<string>();
  for (const k of allKeysUpToCurrent) {
    const entry = resolveEntry(n, k);
    if (entry?.kind === 'scene') {
      for (const km of entry.knowledgeMutations) allMutationNodeIds.add(km.nodeId);
    }
  }

  // Knowledge: keep original (non-mutation) nodes + mutation nodes from the time horizon
  const characters = branchCharacters
    .map((c) => {
      const relevantNodes = c.knowledge.nodes
        .filter((kn) => !allMutationNodeIds.has(kn.id) || horizonKnowledgeNodeIds.has(kn.id));
      const knowledgeLines = relevantNodes.map((kn) => `    (${kn.type}) ${kn.content}`);
      const omitted = c.knowledge.nodes.length - relevantNodes.length;
      const truncated = omitted > 0
        ? `\n  (${omitted} knowledge items outside time horizon omitted)`
        : '';
      const knowledgeBlock = knowledgeLines.length > 0
        ? `\n  Knowledge (${relevantNodes.length} in scope):${truncated}\n${knowledgeLines.join('\n')}`
        : '';
      return `- ${c.id}: ${c.name} (${c.role})${knowledgeBlock}`;
    })
    .join('\n');
  const locations = branchLocations
    .map((l) => {
      const knowledgeLines = l.knowledge.nodes.map((kn) => `    (${kn.type}) ${kn.content}`);
      const knowledgeBlock = knowledgeLines.length > 0
        ? `\n  Knowledge (${l.knowledge.nodes.length}):\n${knowledgeLines.join('\n')}`
        : '';
      return `- ${l.id}: ${l.name}${l.parentId ? ` (inside ${n.locations[l.parentId]?.name ?? l.parentId})` : ''}${knowledgeBlock}`;
    })
    .join('\n');
  // Build thread age context from scene history (within time horizon)
  const threadFirstMutation: Record<string, number> = {};
  const threadMutationCount: Record<string, number> = {};
  keysUpToCurrent.forEach((k, idx) => {
    const scene = n.scenes[k];
    if (!scene) return;
    for (const tm of scene.threadMutations) {
      threadMutationCount[tm.threadId] = (threadMutationCount[tm.threadId] ?? 0) + 1;
      if (threadFirstMutation[tm.threadId] === undefined) threadFirstMutation[tm.threadId] = idx;
    }
  });
  const totalScenes = keysUpToCurrent.length;

  const threads = branchThreads
    .map((t) => {
      const firstMut = threadFirstMutation[t.id];
      const age = firstMut !== undefined ? totalScenes - firstMut : 0;
      const mutations = threadMutationCount[t.id] ?? 0;
      const ageLabel = age > 0 ? `, active ${age} scenes, ${mutations} mutations` : '';
      return `- ${t.id}: ${t.description} [${t.status}${ageLabel}]`;
    })
    .join('\n');
  const relationships = branchRelationships
    .map((r) => {
      const fromName = n.characters[r.from]?.name ?? r.from;
      const toName = n.characters[r.to]?.name ?? r.to;
      return `- ${r.from} (${fromName}) -> ${r.to} (${toName}): ${r.type} (valence: ${Math.round(r.valence * 100) / 100})`;
    })
    .join('\n');

  // All scenes within the time horizon get full mutation detail
  const sceneHistory = keysUpToCurrent.map((k, i) => {
    const s = resolveEntry(n, k);
    if (!s) return '';
    const globalIdx = horizonStart + i + 1;
    if (s.kind === 'world_build') {
      return `[${globalIdx}] ${s.id} [WORLD BUILD]\n   ${s.summary}`;
    }
    const loc = `${s.locationId} (${n.locations[s.locationId]?.name ?? 'unknown'})`;
    const participants = s.participantIds.map((pid) => `${pid} (${n.characters[pid]?.name ?? 'unknown'})`).join(', ');
    const threadChanges = s.threadMutations.map((tm) => `${tm.threadId}: ${tm.from}->${tm.to}`).join('; ');
    const knowledgeChanges = s.knowledgeMutations.map((km) => `${km.characterId} learned [${km.nodeType}]: ${km.content}`).join('; ');
    const relChanges = s.relationshipMutations.map((rm) => {
      const fromName = n.characters[rm.from]?.name ?? rm.from;
      const toName = n.characters[rm.to]?.name ?? rm.to;
      return `${fromName}->${toName}: ${rm.type} (${rm.valenceDelta >= 0 ? '+' : ''}${Math.round(rm.valenceDelta * 100) / 100})`;
    }).join('; ');
    return `[${globalIdx}] ${s.id} @ ${loc} | ${participants}${threadChanges ? ` | Threads: ${threadChanges}` : ''}${knowledgeChanges ? ` | Knowledge: ${knowledgeChanges}` : ''}${relChanges ? ` | Relationships: ${relChanges}` : ''}
   ${s.summary}`;
  }).filter(Boolean).join('\n');

  // Arcs context — only arcs with scenes within the time horizon
  const branchSceneIds = new Set(keysUpToCurrent.filter((k) => n.scenes[k]));
  const arcs = Object.values(n.arcs)
    .filter((a) => !hasHistory || a.sceneIds.some((sid) => branchSceneIds.has(sid)))
    .map((a) => `- ${a.id}: "${a.name}" (${a.sceneIds.length} scenes, develops: ${a.develops.join(', ')})`)
    .join('\n');

  // Force trajectory — computed from all scenes for correct normalization,
  // but only the time horizon is included in the output
  const allScenes = keysUpToCurrent
    .map((k) => resolveEntry(n, k))
    .filter((e): e is Scene => e?.kind === 'scene');
  const forceMap = computeForceSnapshots(allScenes);
  const forceSnapshots = allScenes.map((s) => forceMap[s.id] ?? { payoff: 0, change: 0, variety: 0 });
  const swings = computeSwingMagnitudes(forceSnapshots);
  const payoffMA = movingAverage(forceSnapshots.map(f => f.payoff), FORCE_WINDOW_SIZE);
  const changeMA = movingAverage(forceSnapshots.map(f => f.change), FORCE_WINDOW_SIZE);
  const varietyMA = movingAverage(forceSnapshots.map(f => f.variety), FORCE_WINDOW_SIZE);
  const swingMA = movingAverage(swings, FORCE_WINDOW_SIZE);
  const forceTrajectory = allScenes.map((s, i) => {
    const f = forceMap[s.id];
    if (!f) return null;
    const corner = detectCubeCorner(f);
    return `[${horizonStart + i + 1}] P:${f.payoff >= 0 ? '+' : ''}${f.payoff.toFixed(1)} C:${f.change >= 0 ? '+' : ''}${f.change.toFixed(1)} V:${f.variety >= 0 ? '+' : ''}${f.variety.toFixed(1)} Sw:${swings[i].toFixed(1)} MA(P:${payoffMA[i].toFixed(1)} C:${changeMA[i].toFixed(1)} V:${varietyMA[i].toFixed(1)} Sw:${swingMA[i].toFixed(1)}) (${corner.name})`;
  }).filter(Boolean).join('\n');

  // Current cube position and local beat position
  const currentForces = allScenes.length > 0 ? forceMap[allScenes[allScenes.length - 1].id] : null;
  const currentCube = currentForces ? detectCubeCorner(currentForces) : null;
  const windowScenes = allScenes.slice(-FORCE_WINDOW_SIZE);
  const windowMap = computeForceSnapshots(windowScenes, allScenes.slice(0, -FORCE_WINDOW_SIZE));
  const windowOrdered = windowScenes.map((s) => windowMap[s.id]).filter(Boolean);
  const engPts = computeEngagementCurve(windowOrdered);
  const localPos = engPts.length > 0 ? classifyCurrentPosition(engPts) : null;
  const currentStateBlock = currentCube
    ? `\nCURRENT NARRATIVE STATE:\n  Cube position: ${currentCube.name} (P:${currentForces!.payoff >= 0 ? 'Hi' : 'Lo'} C:${currentForces!.change >= 0 ? 'Hi' : 'Lo'} V:${currentForces!.variety >= 0 ? 'Hi' : 'Lo'}) — ${currentCube.description}\n  Beat position: ${localPos?.name ?? 'Stable'} — ${localPos?.description ?? 'beats are holding steady'}\n`
    : '';

  // Compact ID lookup — placed last so it's closest to the generation prompt
  const charIdList = branchCharacters.map((c) => c.id).join(', ');
  const locIdList = branchLocations.map((l) => l.id).join(', ');
  const threadIdList = branchThreads.map((t) => t.id).join(', ');

  const rulesBlock = n.rules && n.rules.length > 0
    ? `\nWORLD RULES (these are absolute — every scene MUST obey them):\n${n.rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n`
    : '';

  const storySettingsBlock = buildStorySettingsBlock(n);

  const horizonLabel = skippedCount > 0
    ? `SCENE HISTORY (${keysUpToCurrent.length} scenes in time horizon, ${skippedCount} earlier scenes omitted):`
    : `SCENE HISTORY (${keysUpToCurrent.length} scenes on current branch):`;

  return `NARRATIVE: "${n.title}"
WORLD: ${n.worldSummary}
${rulesBlock}${storySettingsBlock}
────────────────────────────────────────
CHARACTERS:
${characters}

────────────────────────────────────────
LOCATIONS:
${locations}

────────────────────────────────────────
THREADS:
${threads}

────────────────────────────────────────
RELATIONSHIPS:
${relationships}

────────────────────────────────────────
ARCS:
${arcs}

────────────────────────────────────────
${horizonLabel}
${sceneHistory}

────────────────────────────────────────
FORCE TRAJECTORY (computed from scene structure — shows pacing rhythm):
${forceTrajectory || '(no scenes yet)'}
${currentStateBlock}
────────────────────────────────────────
VALID IDs (you MUST use ONLY these exact IDs — do NOT invent new ones):
  Character IDs: ${charIdList}
  Location IDs: ${locIdList}
  Thread IDs: ${threadIdList}`;
}

const SYSTEM_PROMPT = `You are a narrative simulation engine that generates structured scene data for interactive storytelling.
You must ALWAYS respond with valid JSON only — no markdown, no explanation, no code fences.

CORE PRINCIPLES:
1. FORCE TARGETS and DIRECTION override scene history. Do NOT continue patterns just because previous scenes established them. If the directive says calm, write calm.
2. High swing is the north star of compelling narrative. Consecutive scenes should feel dynamically different — alternate intensity with quiet, action with reflection, familiar with surprising.
3. Threads are DISTINCT narrative tensions — each one should be genuinely different from every other. Thread advancement is dynamic: some scenes advance several threads at once, others advance none. Let the story dictate the rhythm.
4. Use ONLY the character, location, and thread IDs provided. Never invent new ones.

WRITING LIKE A NOVELIST — every scene should leave a mark:
- Characters are always learning. In every scene, someone notices something, overhears a detail, forms an impression, recalls a memory, or pieces together a clue. Track these as knowledgeMutations — they are the fabric of dramatic irony and character interiority.
- Relationships shift constantly. When characters interact, their dynamics evolve — trust deepens, suspicion grows, respect is earned or lost. Even a shared glance or an awkward silence shifts something. Track these as relationshipMutations with appropriate valenceDelta.
- Events ground scenes in concrete happenings. Tag what actually occurs: "ambush", "confession", "storm_arrival", "treaty_signed", "duel", "feast", "betrayal_revealed". These make scenes feel like real narrative moments, not abstract summaries.
- Thread advancement is dynamic — a quiet scene may touch no threads, while a pivotal scene might advance several at once. Only include mutations where the status actually changes. Padding with no-op mutations is worse than no mutation at all.`;

/** Clean common LLM JSON quirks: code fences, trailing commas, single-quoted keys */
function cleanJson(raw: string): string {
  let s = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  // Remove trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, '$1');
  // Fix unescaped control characters inside JSON string values.
  // Walk character-by-character: when inside a quoted string, escape raw
  // newlines/tabs/backspaces that the LLM forgot to escape.
  const out: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escaped) {
      out.push(ch);
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      out.push(ch);
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out.push(ch);
      continue;
    }
    if (inString) {
      if (ch === '\n') { out.push('\\n'); continue; }
      if (ch === '\r') { out.push('\\r'); continue; }
      if (ch === '\t') { out.push('\\t'); continue; }
    }
    out.push(ch);
  }
  return out.join('');
}

/**
 * Attempt to fix unescaped double-quotes inside JSON string values.
 * When the LLM writes `"she said "hello" to him"`, the inner quotes break
 * the parse. This walks the string and escapes quotes that appear mid-value.
 */
function repairUnescapedQuotes(s: string): string {
  const out: string[] = [];
  let i = 0;
  const len = s.length;

  while (i < len) {
    // Skip whitespace / structural chars outside strings
    if (s[i] !== '"') { out.push(s[i++]); continue; }

    // Opening quote of a string value
    out.push(s[i++]); // the opening "
    // Scan for the *real* closing quote.
    // The real closing quote is followed by a structural char: , } ] :
    // (possibly with whitespace in between).
    while (i < len) {
      if (s[i] === '\\') {
        // Already-escaped char — pass through
        out.push(s[i], s[i + 1] ?? '');
        i += 2;
        continue;
      }
      if (s[i] === '"') {
        // Is this the real closing quote?
        // Look ahead past whitespace for a structural char or EOF
        let peek = i + 1;
        while (peek < len && (s[peek] === ' ' || s[peek] === '\n' || s[peek] === '\r' || s[peek] === '\t')) peek++;
        if (peek >= len || s[peek] === ',' || s[peek] === '}' || s[peek] === ']' || s[peek] === ':') {
          // Real closing quote
          out.push('"');
          i++;
          break;
        } else {
          // Unescaped inner quote — escape it
          out.push('\\"');
          i++;
          continue;
        }
      }
      out.push(s[i++]);
    }
  }
  return out.join('');
}

/** Parse JSON with detailed error context for debugging truncated LLM responses */
function parseJson(raw: string, context: string): unknown {
  if (!raw || !raw.trim()) {
    throw new Error(`[${context}] Empty response from LLM — received no content`);
  }
  const cleaned = cleanJson(raw);
  try {
    return JSON.parse(cleaned);
  } catch (firstErr) {
    // Attempt repair: fix unescaped quotes inside string values
    try {
      const repaired = repairUnescapedQuotes(cleaned);
      return JSON.parse(repaired);
    } catch {
      // Repair didn't help — throw with original error context
    }
    const preview = cleaned.length > 300
      ? `${cleaned.slice(0, 150)}…[${cleaned.length} chars total]…${cleaned.slice(-150)}`
      : cleaned;
    const truncated = cleaned.endsWith('}') || cleaned.endsWith(']') ? '' : ' (likely truncated — response hit max_tokens limit)';
    throw new Error(
      `[${context}] Failed to parse JSON${truncated}\n` +
      `Original error: ${firstErr instanceof Error ? firstErr.message : String(firstErr)}\n` +
      `Response preview: ${preview}`
    );
  }
}

/**
 * Suggest a direction for the next arc based on the full branch context.
 * Returns a short text suggestion the user can edit before generating.
 */
export type DirectionSuggestion = {
  text: string;
  arcName: string;
  suggestedSceneCount: number;
};

export async function suggestDirection(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): Promise<DirectionSuggestion> {
  const ctx = branchContext(narrative, resolvedKeys, currentIndex);

  const prompt = `${ctx}

Based on the full scene history above, suggest the most compelling direction for the NEXT arc.
Consider:
- Unresolved threads and their current statuses
- Character tensions and relationship dynamics
- Narrative momentum (what has been building?)
- What would create the most dramatic escalation?
- How many scenes this arc needs to land properly (don't rush — quiet arcs need fewer, epic arcs need more)

Return JSON with this exact structure:
{
  "arcName": "suggested arc name",
  "direction": "2-3 sentence description of what the next arc should focus on and why",
  "sceneSuggestion": "brief outline of what kind of scenes would work",
  "suggestedSceneCount": 3
}

suggestedSceneCount must be between 1 and 8.`;

  const raw = await callGenerate(prompt, SYSTEM_PROMPT, undefined, 'suggestDirection');
  const parsed = parseJson(raw, 'suggestDirection') as {
    arcName?: string; direction?: string; sceneSuggestion?: string; suggestedSceneCount?: number;
  };
  const sceneCount = Math.max(1, Math.min(8, parsed.suggestedSceneCount ?? 3));
  return {
    text: `${parsed.arcName}: ${parsed.direction}${parsed.sceneSuggestion ? '\n\n' + parsed.sceneSuggestion : ''}`,
    arcName: parsed.arcName ?? '',
    suggestedSceneCount: sceneCount,
  };
}


export async function suggestStoryDirection(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): Promise<string> {
  const ctx = branchContext(narrative, resolvedKeys, currentIndex);

  const prompt = `${ctx}

You are a showrunner planning the long-term trajectory of this story. Analyze the full narrative state — characters, threads, knowledge graphs, relationships, and scene history — and suggest a high-level STORY DIRECTION that should guide the next several arcs.

Think big picture:
- What is the central dramatic question the story is building toward?
- Which character arcs have the most untapped potential?
- What thematic tensions could be deepened or brought into conflict?
- Where should alliances shift, secrets surface, or power dynamics change?
- What is the most satisfying macro-trajectory from where the story stands now?

Do NOT suggest a single scene or arc. Instead, describe the overarching direction the story should move in — the kind of guidance a showrunner gives a writers' room for the next season.

Return JSON: { "direction": "2-4 sentences describing the big-picture story direction" }`;

  const raw = await callGenerate(prompt, SYSTEM_PROMPT, undefined, 'suggestStoryDirection');
  const parsed = parseJson(raw, 'suggestStoryDirection') as { direction?: string };
  return parsed.direction ?? '';
}


export async function generateScenes(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  count: number,
  direction: string,
  existingArc?: Arc,
  cubeGoal?: CubeCornerKey,
  rejectSiblings?: { name: string; summary: string }[],
  worldBuildFocus?: WorldBuildCommit,
  onToken?: (token: string) => void,
): Promise<{ scenes: Scene[]; arc: Arc }> {
  const ctx = branchContext(narrative, resolvedKeys, currentIndex);
  const arcId = existingArc?.id ?? nextId('ARC', Object.keys(narrative.arcs));
  const storySettings: StorySettings = { ...DEFAULT_STORY_SETTINGS, ...narrative.storySettings };
  const targetLen = storySettings.targetArcLength;
  const sceneCountInstruction = count > 0
    ? `exactly ${count} scenes`
    : `${Math.max(2, targetLen - 1)}-${targetLen + 1} scenes (choose the count that best fits the arc's natural length)`;
  const arcInstruction = existingArc
    ? `CONTINUE the existing arc "${existingArc.name}" (${arcId}) which already has ${existingArc.sceneIds.length} scenes. Add ${sceneCountInstruction} that naturally extend this arc.`
    : `Generate a NEW ARC with ${sceneCountInstruction}. Give the arc a short, evocative name (2-4 words) that reads like a chapter title — specific to the story, not generic.`;
  const prompt = `${ctx}

${arcInstruction}
DIRECTION (this takes priority over any patterns in the scene history below):
${direction}
${worldBuildFocus ? (() => {
  const wb = worldBuildFocus;
  const chars = wb.expansionManifest.characterIds
    .map((id) => { const c = narrative.characters[id]; return c ? `${c.name} (${c.role})` : null; })
    .filter(Boolean);
  const locs = wb.expansionManifest.locationIds
    .map((id) => narrative.locations[id]?.name)
    .filter(Boolean);
  const threads = wb.expansionManifest.threadIds
    .map((id) => { const t = narrative.threads[id]; return t ? `${t.description} [${t.status}]` : null; })
    .filter(Boolean);
  const lines: string[] = [`WORLD BUILD FOCUS (${wb.id} — "${wb.summary}"): The entities below were recently introduced and have not yet had a presence in the story. This arc should bring them in — use these characters in scenes, set at least one scene in these locations, and begin activating these dormant threads:`];
  if (chars.length) lines.push(`  Characters: ${chars.join(', ')}`);
  if (locs.length) lines.push(`  Locations: ${locs.join(', ')}`);
  if (threads.length) lines.push(`  Threads to activate: ${threads.join('; ')}`);
  return '\n' + lines.join('\n') + '\n';
})() : ''}
The scenes must continue from the current point in the story (after scene index ${currentIndex + 1}).

${cubeGoal ? (() => {
  const cube = NARRATIVE_CUBE[cubeGoal];
  const p = cube.forces.payoff > 0;
  const c = cube.forces.change > 0;
  const v = cube.forces.variety > 0;
  // Per-corner narrative instructions — each combination gets a distinct creative brief
  const CORNER_INSTRUCTIONS: Record<CubeCornerKey, string> = {
    HHH: `This is a CONVERGENCE arc — everything comes together. Threads should reach critical turning points or resolve. Characters undergo meaningful transformation. Set scenes in new or rarely-visited locations with fresh character combinations. This is the narrative crescendo — stakes are real, consequences are permanent, and the world feels larger than before.`,
    HHL: `This is a CLIMAX arc — the established cast faces their reckoning. Drive threads to critical/terminal statuses with the core characters the reader knows well. Familiar locations become battlegrounds. Characters change profoundly through intense interactions with each other. Keep the cast tight and the stakes personal — this is about payoff for relationships and threads the reader is invested in.`,
    HLH: `This is a REVEAL arc — the landscape shifts without the characters fully grasping it yet. Threads pay off through external events, discoveries, or arrivals rather than character growth. New locations, new faces, surprising information. Characters witness rather than transform — they're processing a changed world. Think: the veil is lifted, a hidden truth surfaces, an unexpected player enters.`,
    HLL: `This is a CLOSURE arc — tying up loose ends in familiar territory. Threads reach resolution quietly — not with a bang but with acceptance, understanding, or quiet consequence. The established cast in known settings, dealing with the aftermath. Characters don't grow so much as settle. Conversations that needed to happen finally do. Debts are paid, promises kept or broken.`,
    LHH: `This is a DISCOVERY arc — characters grow rapidly through encountering the unknown. No threads need to resolve — this is about exploration, world-building, and possibility. New locations, new characters, new dynamics. The cast is learning, adapting, being changed by unfamiliar territory. Think: first contact, uncharted lands, unexpected alliances, culture shock. The energy is curiosity and transformation, not conflict resolution.`,
    LHL: `This is a GROWTH arc — the familiar cast evolves through internal development. No plot payoffs needed — threads stay active but don't resolve. Characters train, bond, argue, process, and change through interaction with each other in known settings. Relationships deepen or fracture. Think: training montages, heart-to-heart conversations, rivalries forming, mentorship, characters confronting their own flaws.`,
    LLH: `This is a WANDERING arc — drifting through unfamiliar territory without resolution or transformation. New places, new faces, but nothing clicking into place yet. Characters observe, encounter, and move on. Threads simmer without advancing. Think: a journey through strange lands, chance encounters, atmospheric world-building, seeds planted that won't sprout until later. The tone is contemplative or mysterious, not urgent.`,
    LLL: `This is a REST arc — recovery and seed-planting in familiar ground. Nothing resolves, nothing transforms dramatically. The established cast in known settings, catching their breath. But REST doesn't mean NOTHING happens — characters have quiet moments of connection, notice small details, plant seeds for future arcs. Subtle foreshadowing, small character beats, domestic or routine scenes with undercurrents.`,
  };
  return `
NARRATIVE CUBE GOAL — "${cube.name}" (${cubeGoal}: Payoff ${p ? 'High' : 'Low'}, Change ${c ? 'High' : 'Low'}, Variety ${v ? 'High' : 'Low'}):
${CORNER_INSTRUCTIONS[cubeGoal]}

This goal OVERRIDES any momentum from previous scenes. Write scenes that genuinely embody this corner's energy — don't default to generic action or generic rest.`;
})() : ''}
${rejectSiblings && rejectSiblings.length > 0 ? `
ALREADY GENERATED AT THIS BRANCH POINT (${rejectSiblings.length} alternatives exist):
${rejectSiblings.filter((s) => s.summary).map((s) => `- "${s.name}": ${s.summary}`).join('\n')}
${rejectSiblings.filter((s) => !s.summary).length > 0 ? `Also being generated in parallel: ${rejectSiblings.filter((s) => !s.summary).map((s) => s.name).join(', ')}` : ''}

CRITICAL: Your arc MUST be substantially different from ALL of the above. Do NOT use similar arc names (avoid "Echoes of…", "Seeds of…", "Whispers of…" if those patterns appear above). Do NOT cover the same plot beats or involve the same character groupings. Find a completely different angle — a different subplot, different characters in focus, a different emotional register, or a different narrative question entirely.` : ''}

Return JSON with this exact structure:
{
  "arcName": "A short, evocative arc name (2-4 words) like a chapter title. Must be UNIQUE — not a variation of any existing arc name. Bad: 'Continuation', 'New Beginnings', 'Echoes of X', 'Seeds of Y'. Good: 'The Siege of Ashenmoor', 'Fractured Oaths', 'Blackwater Gambit'.",
  "scenes": [
    {
      "id": "S-GEN-001",
      "arcId": "${arcId}",
      "locationId": "existing location ID from the narrative",
      "povId": "character ID whose perspective this scene is told from (MUST be an anchor-role character who is also a participant)${storySettings.povMode !== 'free' && storySettings.povCharacterIds.length > 0 ? ` — RESTRICTED to: ${storySettings.povCharacterIds.join(', ')}` : ''}",
      "participantIds": ["existing character IDs"],
      "events": ["event_tag_1", "event_tag_2"],
      "threadMutations": [{"threadId": "T-XX", "from": "current_status", "to": "new_status"}],
      "knowledgeMutations": [{"characterId": "C-XX", "nodeId": "K-GEN-001", "action": "added", "content": "what they learned", "nodeType": "a descriptive type for this knowledge"}],
      "relationshipMutations": [{"from": "C-XX", "to": "C-YY", "type": "description", "valenceDelta": 0.1}],
      "summary": "REQUIRED: 2-4 sentence narrative summary written in vivid, character-driven prose. Describe what happens, who is involved, and the emotional stakes."
    }
  ]
}

Rules:
- EVERY scene MUST have a non-empty "summary" field. This is critical — scenes without summaries are broken. Write 2-4 vivid sentences describing the scene's events, characters, and emotional stakes.
- Use ONLY existing character IDs and location IDs from the narrative context above
- Thread statuses follow a lifecycle. ${THREAD_LIFECYCLE_DOC}
- Threads that have reached their narrative conclusion MUST be transitioned to a terminal status. Do not leave threads stuck in active states when their story is over. When a mystery is solved, a conflict is won/lost, a goal is achieved or failed — close the thread.
- Each thread must be DISTINCT — if two threads describe the same underlying tension, they should be merged. Only mutate threads whose status actually changes in this scene.
- Scene IDs must be unique: S-GEN-001, S-GEN-002, etc.
- Knowledge node IDs must be unique: K-GEN-001, K-GEN-002, etc.
- knowledgeMutations.nodeType should be a specific, contextual label for what kind of knowledge this is — NOT limited to a fixed set. Examples: "tactical_insight", "betrayal_discovered", "forbidden_technique", "political_leverage", "hidden_lineage", "oath_sworn". Choose the type that best describes the specific knowledge gained.
- Thread mutations should reflect the direction — escalate relevant threads, surface dormant ones when appropriate
- relationshipMutations track how character dynamics shift. Include them when interactions change — trust gained, betrayal discovered, alliance forming, rivalry deepening. valenceDelta ranges from -0.5 (major damage) to +0.5 (major bonding). Most interactions are ±0.1 to ±0.2.
- knowledgeMutations track what characters learn. Include them when a character gains or loses information — secrets revealed, lies uncovered, skills observed, intel gathered.
- events capture concrete narrative happenings. Use specific, descriptive tags: "ambush_at_dawn", "secret_pact_formed", "duel_of_wits", "storm_breaks", "letter_intercepted". Aim for 2-4 events per scene. Events contribute to the Change force — more events = higher narrative momentum.

NARRATIVE RICHNESS (what separates good scenes from flat ones):
- Think like a novelist: every scene changes SOMETHING about how characters understand their world and relate to each other. A scene where nothing shifts — no knowledge gained, no relationship moved, no events tagged — reads as filler.
- Quiet/reflective scenes still have internal life: a character notices someone's hesitation, recalls a painful memory, warms slightly to a companion, or overhears something unsettling.
- Intense/climactic scenes should be dense with consequence: threads advance, characters learn things that change their calculus, relationships crack or forge under pressure, and multiple concrete events unfold.
- Events are the skeleton of what happens — tag them generously. They help readers (and the system) understand the scene's narrative weight.

PACING:
- Not every scene should be a major plot event. Include quieter scenes: character moments, travel, reflection, relationship building.
- Only 1 in 3 scenes should be a significant plot beat. Others build atmosphere, deepen character, or plant seeds.
- Even quiet scenes MUST have mutations — a character noticing tension, recalling a memory, warming to an ally, or growing suspicious all count.
- Threads evolve gradually — a dormant thread surfaces over several scenes, not in one jump. But don't be afraid to escalate when the story demands it.
- When a thread's storyline has concluded (conflict resolved, mystery answered, goal achieved or failed), transition it to a terminal status: ${THREAD_TERMINAL_STATUSES.map((s) => `"${s}"`).join(', ')}. Choose the terminal status that best fits HOW the thread ended.
- Do NOT include thread mutations where the status doesn't change (e.g. "active" → "active"). Only include mutations that represent real narrative movement.

CRITICAL ID CONSTRAINT (re-stated for emphasis):
You MUST use ONLY these exact IDs. Do NOT invent new character, location, or thread IDs.
  Character IDs: ${Object.keys(narrative.characters).join(', ')}
  Location IDs: ${Object.keys(narrative.locations).join(', ')}
  Thread IDs: ${Object.keys(narrative.threads).join(', ')}`;

  const raw = onToken
    ? await callGenerateStream(prompt, SYSTEM_PROMPT, onToken, undefined, 'generateScenes')
    : await callGenerate(prompt, SYSTEM_PROMPT, undefined, 'generateScenes');

  const parsed = parseJson(raw, 'generateScenes') as { arcName?: string; scenes: Scene[] };
  const arcName = existingArc?.name ?? parsed.arcName ?? 'Untitled Arc';

  const sceneIds = nextIds('S', Object.keys(narrative.scenes), parsed.scenes.length, 3);
  const scenes: Scene[] = parsed.scenes.map((s: Scene, i: number) => ({
    ...s,
    kind: 'scene' as const,
    id: sceneIds[i],
    arcId,
    summary: s.summary || `Scene ${i + 1} of arc "${arcName}"`,
  }));

  // Sanitize hallucinated IDs — filter out invalid references instead of crashing
  const validCharIds = new Set(Object.keys(narrative.characters));
  const validLocIds = new Set(Object.keys(narrative.locations));
  const validThreadIds = new Set(Object.keys(narrative.threads));
  const stripped: string[] = [];

  // Determine anchor characters and find the most-used anchor by POV count for fallback
  const anchorIds = new Set(Object.entries(narrative.characters).filter(([, c]) => c.role === 'anchor').map(([id]) => id));
  const povCounts = new Map<string, number>();
  for (const s of Object.values(narrative.scenes)) {
    if (s.povId && anchorIds.has(s.povId)) {
      povCounts.set(s.povId, (povCounts.get(s.povId) ?? 0) + 1);
    }
  }
  const mostUsedAnchor = [...anchorIds].sort((a, b) => (povCounts.get(b) ?? 0) - (povCounts.get(a) ?? 0))[0]
    ?? Object.keys(narrative.characters)[0];

  for (const scene of scenes) {
    // Fix invalid locationId — fall back to first valid location
    if (!validLocIds.has(scene.locationId)) {
      stripped.push(`locationId "${scene.locationId}" in scene ${scene.id}`);
      scene.locationId = Object.keys(narrative.locations)[0];
    }
    // Fix invalid povId — must be a valid anchor character, fallback to most-used anchor
    if (!scene.povId || !validCharIds.has(scene.povId) || !anchorIds.has(scene.povId)) {
      if (scene.povId) stripped.push(`povId "${scene.povId}" in scene ${scene.id} (non-anchor or invalid)`);
      scene.povId = scene.participantIds.find((pid) => anchorIds.has(pid)) ?? mostUsedAnchor;
    }
    // Remove invalid participantIds
    const validParticipants = scene.participantIds.filter((pid) => {
      if (validCharIds.has(pid)) return true;
      stripped.push(`participantId "${pid}" in scene ${scene.id}`);
      return false;
    });
    scene.participantIds = validParticipants.length > 0
      ? validParticipants
      : [Object.keys(narrative.characters)[0]]; // ensure at least one participant
    // Ensure povId is a valid anchor participant
    if (!scene.participantIds.includes(scene.povId) || !anchorIds.has(scene.povId)) {
      scene.povId = scene.participantIds.find((pid) => anchorIds.has(pid)) ?? mostUsedAnchor;
    }
    // Remove invalid threadMutations
    scene.threadMutations = scene.threadMutations.filter((tm) => {
      if (validThreadIds.has(tm.threadId)) return true;
      stripped.push(`threadId "${tm.threadId}" in scene ${scene.id}`);
      return false;
    });
    // Remove invalid knowledgeMutations
    scene.knowledgeMutations = scene.knowledgeMutations.filter((km) => {
      if (!km.characterId || validCharIds.has(km.characterId)) return true;
      stripped.push(`knowledgeMutation characterId "${km.characterId}" in scene ${scene.id}`);
      return false;
    });
    // Remove invalid relationshipMutations
    scene.relationshipMutations = scene.relationshipMutations.filter((rm) => {
      if (validCharIds.has(rm.from) && validCharIds.has(rm.to)) return true;
      stripped.push(`relationshipMutation "${rm.from}" -> "${rm.to}" in scene ${scene.id}`);
      return false;
    });
  }

  if (stripped.length > 0) {
    console.warn(
      `[generateScenes] Stripped ${stripped.length} hallucinated ID(s):\n` +
      stripped.map((h) => `  - ${h}`).join('\n')
    );
  }

  // Fix knowledge mutation IDs to be unique and sequential
  const existingKIds = [
    ...Object.values(narrative.characters).flatMap((c) => c.knowledge.nodes.map((n) => n.id)),
    ...Object.values(narrative.locations).flatMap((l) => l.knowledge.nodes.map((n) => n.id)),
  ];
  const totalKMutations = scenes.reduce((sum, s) => sum + s.knowledgeMutations.length, 0);
  const kIds = nextIds('K', existingKIds, totalKMutations);
  let kIdx = 0;
  for (const scene of scenes) {
    for (const km of scene.knowledgeMutations) {
      km.nodeId = kIds[kIdx++];
    }
  }

  const newSceneIds = scenes.map((s) => s.id);
  const newDevelops = [...new Set(scenes.flatMap((s) => s.threadMutations.map((tm) => tm.threadId)))];
  const newLocationIds = [...new Set(scenes.map((s) => s.locationId))];
  const newCharacterIds = [...new Set(scenes.flatMap((s) => s.participantIds))];

  const arc: Arc = existingArc
    ? {
        ...existingArc,
        sceneIds: [...existingArc.sceneIds, ...newSceneIds],
        develops: [...new Set([...existingArc.develops, ...newDevelops])],
        locationIds: [...new Set([...existingArc.locationIds, ...newLocationIds])],
        activeCharacterIds: [...new Set([...existingArc.activeCharacterIds, ...newCharacterIds])],
      }
    : {
        id: arcId,
        name: arcName,
        sceneIds: newSceneIds,
        develops: newDevelops,
        locationIds: newLocationIds,
        activeCharacterIds: newCharacterIds,
        initialCharacterLocations: {},
      };

  if (!existingArc && scenes.length > 0) {
    for (const cid of arc.activeCharacterIds) {
      const firstScene = scenes.find((s) => s.participantIds.includes(cid));
      if (firstScene) {
        arc.initialCharacterLocations[cid] = firstScene.locationId;
      }
    }
  }

  return { scenes, arc };
}

/**
 * Suggest world expansion based on full branch context.
 */
export async function suggestWorldExpansion(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): Promise<string> {
  const ctx = branchContext(narrative, resolvedKeys, currentIndex);

  const prompt = `${ctx}

Based on the full narrative context above, suggest what NEW elements the world needs.
World expansion is critical for narrative VARIETY — it introduces fresh characters, unexplored locations, and dormant threads that prevent the story from becoming repetitive.

Consider:
- Are there locations referenced in scenes that don't exist yet?
- Are there implied characters who should be introduced?
- Are there narrative threads that need new anchors?
- What would deepen the world and create new story possibilities?
- Which parts of the world feel underexplored or geographically narrow?
- Are there factions, organizations, or communities implied but not yet represented by characters?
- Could contrasting environments (urban vs wild, sacred vs profane, safe vs dangerous) create richer scene variety?
- Are there secondary characters who could become POV-worthy with more depth?

Aim for breadth: suggest 2-3 new characters from different walks of life, 2-3 locations that contrast with existing ones, and 2-3 threads that introduce new dramatic questions.

Return JSON with this exact structure:
{
  "suggestion": "2-4 sentence description of what should be added to the world and why"
}`;

  const raw = await callGenerate(prompt, SYSTEM_PROMPT, undefined, 'suggestWorldExpansion');
  const parsed = parseJson(raw, 'suggestWorldExpansion') as { suggestion: string };
  return parsed.suggestion;
}

/**
 * Generate new world elements (characters, locations, threads, relationships)
 * that get merged into the existing narrative.
 */
export type WorldExpansionSize = 'small' | 'medium' | 'large';

const EXPANSION_SIZE_CONFIG: Record<WorldExpansionSize, { characters: string; locations: string; threads: string; label: string }> = {
  small:  { characters: '1-2',   locations: '1-2',   threads: '1-2',   label: 'a focused expansion' },
  medium: { characters: '3-5',   locations: '3-4',   threads: '3-5',   label: 'a moderate expansion' },
  large:  { characters: '8-15',  locations: '6-10',  threads: '8-12',  label: 'a large-scale expansion' },
};

export async function expandWorld(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  directive: string,
  size: WorldExpansionSize = 'medium',
): Promise<WorldExpansion> {
  const ctx = branchContext(narrative, resolvedKeys, currentIndex);

  // Compute next sequential IDs for the AI to use
  const nextCharId = nextId('C', Object.keys(narrative.characters));
  const nextLocId = nextId('L', Object.keys(narrative.locations));
  const nextThreadId = nextId('T', Object.keys(narrative.threads));
  const existingKIds = [
    ...Object.values(narrative.characters).flatMap((c) => c.knowledge.nodes.map((n) => n.id)),
    ...Object.values(narrative.locations).flatMap((l) => l.knowledge.nodes.map((n) => n.id)),
  ];
  const nextKId = nextId('K', existingKIds);

  const prompt = `${ctx}

EXPAND the world based on this directive: ${directive}

This is ${EXPANSION_SIZE_CONFIG[size].label}. Generate exactly:
- ${EXPANSION_SIZE_CONFIG[size].characters} new characters
- ${EXPANSION_SIZE_CONFIG[size].locations} new locations
- ${EXPANSION_SIZE_CONFIG[size].threads} new threads
- Relationships to connect new characters to existing ones

Use sequential IDs continuing from the existing ones.

Return JSON with this exact structure:
{
  "characters": [
    {
      "id": "${nextCharId}",
      "name": "string",
      "role": "anchor|recurring|transient",
      "threadIds": [],
      "imagePrompt": "1-2 sentence visual description: physical appearance, clothing, distinguishing features. Used for portrait generation.",
      "knowledge": {
        "nodes": [{"id": "${nextKId}", "type": "contextual_type", "content": "string"}]
      }
    }
  ],
  "locations": [
    {
      "id": "${nextLocId}",
      "name": "string",
      "parentId": null or "existing location ID for nesting",
      "threadIds": [],
      "imagePrompt": "1-2 sentence visual description: architecture, landscape, atmosphere, lighting. Used for establishing shot generation.",
      "knowledge": {
        "nodes": [{"id": "K-next", "type": "contextual_type", "content": "string"}]
      }
    }
  ],
  "threads": [
    {
      "id": "${nextThreadId}",
      "anchors": [{"id": "character or location ID", "type": "character|location"}],
      "description": "string",
      "status": "dormant",
      "openedAt": "new",
      "dependents": []
    }
  ],
  "relationships": [
    {"from": "character ID", "to": "character ID", "type": "description", "valence": 0.0}
  ]
}

ID RULES:
- Character IDs: continue sequentially from ${nextCharId} (e.g., ${nextCharId}, C-${String(parseInt(nextCharId.split('-').pop()!) + 1).padStart(2, '0')}, ...)
- Location IDs: continue sequentially from ${nextLocId} (e.g., ${nextLocId}, L-${String(parseInt(nextLocId.split('-').pop()!) + 1).padStart(2, '0')}, ...)
- Thread IDs: continue sequentially from ${nextThreadId} (e.g., ${nextThreadId}, T-${String(parseInt(nextThreadId.split('-').pop()!) + 1).padStart(2, '0')}, ...)
- Knowledge node IDs: continue sequentially from ${nextKId} (e.g., ${nextKId}, K-${String(parseInt(nextKId.split('-').pop()!) + 1).padStart(2, '0')}, ...)
- ALL knowledge nodes (in both characters and locations) use the K- prefix and share one sequence

Rules:
- Generate elements that serve the directive AND boost narrative VARIETY — fresh faces, new settings, and untapped dramatic questions
- Characters should have meaningful knowledge (3-5 nodes). Give each character SECRETS or unique knowledge that only they possess — this creates knowledge asymmetries that drive dramatic tension when revealed later. Include at least one hidden or dangerous piece of knowledge per character.
- Knowledge node types should be SPECIFIC and CONTEXTUAL — not generic labels. Choose types that describe exactly what kind of knowledge or lore this is. Examples: "cultivation_technique", "blood_pact", "hidden_treasury", "ancient_prophecy", "political_alliance", "forbidden_memory", "territorial_claim", "ancestral_grudge". Pick types that fit the narrative world.
- Locations should fit the world hierarchy (use existing parentIds where appropriate). Make new locations CONTRAST with existing ones — if the story has been set in cities, add wilderness; if in palaces, add slums or ruins. Environmental variety drives scene variety.
- Location knowledge should describe lore, dangers, secrets, or resources specific to that place (3-4 nodes per location)
- Threads should connect to existing or new characters/locations via anchors. New threads should introduce DIFFERENT types of dramatic questions than existing ones — if current threads are about conflict, add threads about mystery, loyalty, or forbidden knowledge.
- ALL new threads MUST have status "dormant" — they are seeds for future arcs, not active storylines yet
- Relationships should connect new characters to EXISTING ones (not just to each other) — this ensures new characters integrate into the story rather than remaining isolated. Include at least one relationship with valence tension (slight negative or ambivalent).
- Anchors in threads can reference existing characters/locations
- Generate the exact counts specified above (${EXPANSION_SIZE_CONFIG[size].characters} characters, ${EXPANSION_SIZE_CONFIG[size].locations} locations, ${EXPANSION_SIZE_CONFIG[size].threads} threads)`;

  const raw = await callGenerate(prompt, SYSTEM_PROMPT, undefined, 'expandWorld');
  const parsed = parseJson(raw, 'expandWorld') as WorldExpansion;

  // Force all world-build threads to dormant — they're seeds, not active storylines
  const threads = (parsed.threads ?? []).map((t: Thread) => ({ ...t, status: THREAD_ACTIVE_STATUSES[0] }));

  return {
    characters: parsed.characters ?? [],
    locations: parsed.locations ?? [],
    threads,
    relationships: parsed.relationships ?? [],
  };
}

/**
 * Generate literary prose for a single scene, suitable for a book-style reading experience.
 */

/** Build a discrete context block for a single scene — a focused version of branchContext.
 *  Includes the scene's mutations, recent knowledge for involved characters/locations,
 *  and the relationship state between participants. */
export function sceneContext(narrative: NarrativeState, scene: Scene): string {
  const location = narrative.locations[scene.locationId];
  const pov = narrative.characters[scene.povId];
  const participants = scene.participantIds.map((pid) => narrative.characters[pid]).filter(Boolean);
  const arc = Object.values(narrative.arcs).find((a) => a.sceneIds.includes(scene.id));
  const participantIdSet = new Set(scene.participantIds);

  // ── Characters: full knowledge graph for each participant ──────────
  const RECENT_KNOWLEDGE = 5; // only most recent nodes to avoid context bloat

  const characterBlocks = participants.map((p) => {
    const recentNodes = p.knowledge.nodes.slice(-RECENT_KNOWLEDGE);
    const omitted = p.knowledge.nodes.length - recentNodes.length;
    const knLines = recentNodes.map((kn) => `    (${kn.type}) ${kn.content}`);
    const omittedNote = omitted > 0 ? `\n    (${omitted} earlier items omitted)` : '';
    const knBlock = knLines.length > 0
      ? `\n  Knowledge (${recentNodes.length} recent):${omittedNote}\n${knLines.join('\n')}`
      : '';
    return `  - ${p.id}: ${p.name} (${p.role})${knBlock}`;
  });

  // ── Location: recent knowledge ─────────────────────────────────────
  const locationBlock = (() => {
    if (!location) return '  - Unknown';
    const recentNodes = location.knowledge.nodes.slice(-RECENT_KNOWLEDGE);
    const omitted = location.knowledge.nodes.length - recentNodes.length;
    const knLines = recentNodes.map((kn) => `    (${kn.type}) ${kn.content}`);
    const omittedNote = omitted > 0 ? `\n    (${omitted} earlier items omitted)` : '';
    const knBlock = knLines.length > 0
      ? `\n  Knowledge (${recentNodes.length} recent):${omittedNote}\n${knLines.join('\n')}`
      : '';
    const parent = location.parentId ? ` (inside ${narrative.locations[location.parentId]?.name ?? location.parentId})` : '';
    return `  - ${location.id}: ${location.name}${parent}${knBlock}`;
  })();

  // ── Relationships between participants ─────────────────────────────
  const relevantRelationships = narrative.relationships.filter(
    (r) => participantIdSet.has(r.from) && participantIdSet.has(r.to),
  );
  const relationshipStateLines = relevantRelationships.map((r) => {
    const fromName = narrative.characters[r.from]?.name ?? r.from;
    const toName = narrative.characters[r.to]?.name ?? r.to;
    return `  - ${fromName} → ${toName}: ${r.type} (valence: ${Math.round(r.valence * 100) / 100})`;
  });

  // ── Threads involved in this scene ─────────────────────────────────
  const threadIds = new Set(scene.threadMutations.map((tm) => tm.threadId));
  const threadBlocks = [...threadIds].map((tid) => {
    const thread = narrative.threads[tid];
    if (!thread) return `  - ${tid}: unknown`;
    const anchors = thread.anchors.map((a) => {
      if (a.type === 'character') return narrative.characters[a.id]?.name ?? a.id;
      if (a.type === 'location') return narrative.locations[a.id]?.name ?? a.id;
      return a.id;
    });
    return `  - ${tid}: "${thread.description}" [${thread.status}] anchors: ${anchors.join(', ')}`;
  });

  // ── Scene mutations ────────────────────────────────────────────────
  const threadMutationLines = scene.threadMutations.map((tm) => {
    const thread = narrative.threads[tm.threadId];
    return `  - "${thread?.description ?? tm.threadId}": ${tm.from} → ${tm.to}`;
  });

  const knowledgeMutationLines = scene.knowledgeMutations.map((km) => {
    const char = narrative.characters[km.characterId];
    return `  - ${char?.name ?? km.characterId} ${km.action === 'added' ? 'learns' : 'loses'}: [${km.nodeType ?? 'knowledge'}] ${km.content}`;
  });

  const relationshipMutationLines = scene.relationshipMutations.map((rm) => {
    const fromName = narrative.characters[rm.from]?.name ?? rm.from;
    const toName = narrative.characters[rm.to]?.name ?? rm.to;
    return `  - ${fromName} → ${toName}: ${rm.type} (${rm.valenceDelta >= 0 ? '+' : ''}${Math.round(rm.valenceDelta * 100) / 100})`;
  });

  const movementLines = scene.characterMovements
    ? Object.entries(scene.characterMovements).map(([charId, locId]) => {
        const char = narrative.characters[charId];
        const loc = narrative.locations[locId];
        return `  - ${char?.name ?? charId} moves to ${loc?.name ?? locId}`;
      })
    : [];

  const SEP = '────────────────────────────────────────';

  return [
    `Scene: ${scene.id}`,
    `Summary: ${scene.summary}`,
    `Arc: ${arc?.name ?? 'standalone'}`,
    `POV: ${pov?.name ?? 'Unknown'} (${pov?.role ?? 'unknown role'})`,
    ``,
    SEP,
    `CHARACTERS:`,
    ...characterBlocks,
    ``,
    SEP,
    `LOCATION:`,
    locationBlock,
    ``,
    ...(relationshipStateLines.length > 0 ? [
      SEP,
      `RELATIONSHIPS (current state):`,
      ...relationshipStateLines,
      ``,
    ] : []),
    ...(threadBlocks.length > 0 ? [
      SEP,
      `THREADS (involved):`,
      ...threadBlocks,
      ``,
    ] : []),
    SEP,
    `EVENTS:`,
    ...scene.events.map((e) => `  - ${e}`),
    ...(threadMutationLines.length > 0 ? [
      ``,
      SEP,
      `THREAD SHIFTS:`,
      ...threadMutationLines,
    ] : []),
    ...(knowledgeMutationLines.length > 0 ? [
      ``,
      SEP,
      `KNOWLEDGE CHANGES:`,
      ...knowledgeMutationLines,
    ] : []),
    ...(relationshipMutationLines.length > 0 ? [
      ``,
      SEP,
      `RELATIONSHIP SHIFTS:`,
      ...relationshipMutationLines,
    ] : []),
    ...(movementLines.length > 0 ? [
      ``,
      SEP,
      `MOVEMENTS:`,
      ...movementLines,
    ] : []),
  ].join('\n');
}

/** Estimate scene complexity to drive dynamic length guidance.
 *  Returns { prose: { min, max, tokens }, plan: { words } } */
function sceneScale(scene: Scene): { proseMin: number; proseMax: number; proseTokens: number; planWords: string } {
  const mutations = scene.threadMutations.length + scene.knowledgeMutations.length + scene.relationshipMutations.length;
  const events = scene.events.length;
  const movements = scene.characterMovements ? Object.keys(scene.characterMovements).length : 0;
  const participants = scene.participantIds.length;
  const summaryLen = scene.summary.length;

  // Complexity score: more mutations, events, participants, and longer summaries = bigger scene
  const complexity = mutations * 2 + events * 1.5 + movements + participants * 0.5 + (summaryLen > 200 ? 2 : 0) + (summaryLen > 400 ? 3 : 0);

  let proseMin: number;
  let proseMax: number;
  if (complexity <= 4) { proseMin = 800; proseMax = 1200; }
  else if (complexity <= 8) { proseMin = 1000; proseMax = 1500; }
  else if (complexity <= 14) { proseMin = 1200; proseMax = 2500; }
  else if (complexity <= 20) { proseMin = 1500; proseMax = 3500; }
  else { proseMin = 2000; proseMax = 5000; }

  // Token budget: ~1.3 tokens per word + headroom
  const proseTokens = Math.ceil(proseMax * 1.5);
  // Plan scales proportionally — roughly 40-60% of prose length in words
  const planMin = Math.round(proseMin * 0.4);
  const planMax = Math.round(proseMax * 0.5);
  const planWords = `${planMin}-${planMax}`;

  return { proseMin, proseMax, proseTokens, planWords };
}

/**
 * Generate a detailed beat-by-beat plan for a scene.
 * Expands thin structural mutations into concrete mechanisms — discovery devices,
 * dialogue tensions, spatial staging — so the prose LLM follows a rich blueprint.
 */
export async function generateScenePlan(
  narrative: NarrativeState,
  scene: Scene,
  _sceneIndex: number,
  resolvedKeys: string[],
  onToken?: (token: string) => void,
): Promise<string> {
  const sceneIdx = resolvedKeys.indexOf(scene.id);
  const contextIndex = sceneIdx >= 0 ? sceneIdx : resolvedKeys.length - 1;
  const fullContext = branchContext(narrative, resolvedKeys, contextIndex);
  const sceneBlock = sceneContext(narrative, scene);
  const logicRules = deriveLogicRules(narrative, scene);
  const logicBlock = logicRules.length > 0
    ? `\nLOGICAL CONSTRAINTS (the plan must satisfy all of these):\n${logicRules.map((r) => `  - ${r}`).join('\n')}\n`
    : '';

  // Adjacent scene plans for flow continuity
  const prevSceneKey = sceneIdx > 0 ? resolvedKeys[sceneIdx - 1] : null;
  const prevScene = prevSceneKey ? narrative.scenes[prevSceneKey] : null;
  const prevPlan = prevScene?.plan;

  const nextSceneKey = sceneIdx < resolvedKeys.length - 1 ? resolvedKeys[sceneIdx + 1] : null;
  const nextScene = nextSceneKey ? narrative.scenes[nextSceneKey] : null;
  const nextPlan = nextScene?.plan;

  const adjacentBlock = [
    prevPlan ? `PREVIOUS SCENE PLAN (your opening state must flow from this scene's closing state):\n${prevPlan}` : '',
    nextPlan ? `NEXT SCENE PLAN (your closing state must hand off naturally to this scene's opening):\n${nextPlan}` : '',
  ].filter(Boolean).join('\n\n');

  const scale = sceneScale(scene);

  const systemPrompt = `You are a dramaturg and scene architect for "${narrative.title}". Your job is to expand structural beats into a detailed staging plan that a prose writer can follow. Do NOT write prose — write a blueprint.

Output format (free-form text — length should match the scene's complexity; a simple scene needs a short plan, a dense multi-thread convergence needs a thorough one):

OPENING STATE
2-3 sentences: where characters are physically, what they know, emotional temperature entering the scene.

BEATS
Numbered list (4-8 beats). Each beat specifies:
- Trigger: what initiates this moment
- Action: what happens physically and emotionally
- Shift: what mutation (thread/knowledge/relationship) this dramatises, and HOW it occurs mechanically

Every structural mutation in the scene data MUST map to at least one beat with a concrete mechanism:
- Thread transitions need a trigger (not "the thread becomes active" but "the letter falls from the coat pocket, she reads it aloud")
- Knowledge discoveries need a device (overheard, found object, deduction, confession, demonstration, letter, physical evidence)
- Relationship shifts need a catalytic moment (a specific line, gesture, betrayal, sacrifice, shared danger)
- Do NOT reuse the same discovery device across multiple beats

DIALOGUE SEEDS
2-4 key exchanges. For each: who speaks, the surface topic, and the subtext underneath. Not full dialogue — just the tension map.

CLOSING STATE
2-3 sentences: where everyone ends up physically and emotionally. What has irrevocably changed.

POV KNOWLEDGE DISCIPLINE:
- The scene is told from the POV character's perspective. They can only perceive what their senses and existing knowledge allow.
- In the OPENING STATE, specify exactly what the POV character knows and does NOT know. This sets the information boundary for the entire scene.
- When planning beats where NON-POV characters act on private knowledge, describe only their observable behaviour — the POV character must interpret from the outside (and may misread the situation).
- When the POV character discovers new knowledge, the beat must specify the exact mechanism: what they see, hear, read, or deduce. No omniscient revelation.
- If another character conceals something from the POV character, note what the POV character sees on the surface vs. what is actually happening underneath. The plan should mark which layer the prose can access.

Rules:
- Be specific and concrete. "A tense exchange" is useless. "She asks about the missing shipment; he deflects by mentioning the festival" is useful.
- Include spatial blocking: who is where, who moves, sightlines, physical proximity.
- The plan must cover ALL events, thread mutations, knowledge mutations, relationship mutations, and character movements listed in the scene data. Missing any is a failure.
- Output ONLY the plan text. No JSON, no markdown fences, no commentary.`;

  const prompt = `BRANCH CONTEXT (for continuity — do not repeat):
${fullContext}

${adjacentBlock ? `${adjacentBlock}\n\n` : ''}${sceneBlock}
${logicBlock}
Create a detailed staging plan for this scene. Every structural mutation must have a concrete mechanism. Be specific about HOW things happen, not just WHAT happens.`;

  if (onToken) {
    return await callGenerateStream(prompt, systemPrompt, onToken, Math.ceil(scale.proseTokens * 0.6), 'generateScenePlan');
  }
  return await callGenerate(prompt, systemPrompt, Math.ceil(scale.proseTokens * 0.6), 'generateScenePlan');
}

/**
 * Reconcile a batch of scene plans for cross-scene coherence.
 * Single LLM call that checks thread ordering, emotional continuity,
 * repeated discovery mechanisms, pacing, and spatial handoffs.
 * Returns only the plans that changed.
 */
export type ReconcileRevision = { plan: string; reason: string };

export async function reconcileScenePlans(
  narrative: NarrativeState,
  plans: { sceneId: string; plan: string }[],
): Promise<Record<string, ReconcileRevision>> {
  if (plans.length < 2) return {};

  const sceneSummaries = plans.map((p, i) => {
    const scene = narrative.scenes[p.sceneId];
    if (!scene) return `[${i + 1}] ${p.sceneId}\n${p.plan}`;
    const pov = narrative.characters[scene.povId]?.name ?? scene.povId;
    const loc = narrative.locations[scene.locationId]?.name ?? scene.locationId;
    const threadShifts = scene.threadMutations.map((tm) => {
      const t = narrative.threads[tm.threadId];
      return `${t?.description ?? tm.threadId}: ${tm.from} → ${tm.to}`;
    }).join('; ');
    return `[${i + 1}] ${p.sceneId} | POV: ${pov} | Location: ${loc}${threadShifts ? ` | Threads: ${threadShifts}` : ''}
PLAN:
${p.plan}`;
  }).join('\n\n---\n\n');

  const systemPrompt = `You are a story editor reviewing scene plans for continuity, pacing, and mechanical variety. Return ONLY valid JSON — no markdown, no commentary.`;

  const prompt = `Review these ${plans.length} sequential scene plans from "${narrative.title}" for cross-scene coherence.

${sceneSummaries}

Check for:
1. THREAD ORDERING: If thread T transitions in scene 3, earlier scene plans should not treat it as already transitioned.
2. EMOTIONAL CONTINUITY: A character ending scene N in a particular emotional state should open scene N+1 consistently.
3. REPEATED MECHANISMS: If scene 1 uses "overheard conversation" as a discovery device, later scenes should use different devices.
4. PACING: Not all scenes should have the same intensity or number of beats.
5. SPATIAL HANDOFFS: Character positions at scene N's closing must match scene N+1's opening.

Return JSON:
{
  "revisions": [
    {
      "sceneId": "S-XXX",
      "revisedPlan": "the full revised plan text",
      "reason": "brief explanation of what was changed and why"
    }
  ]
}

Rules:
- Only include scenes that need changes. If all plans are coherent, return {"revisions": []}.
- Preserve the plan structure (OPENING STATE, BEATS, DIALOGUE SEEDS, CLOSING STATE).
- Do not change WHAT happens — only HOW it's staged, ordered, or mechanically delivered.
- Preserve each plan's length — don't compress or expand unless the change requires it.`;

  const raw = await callGenerate(prompt, systemPrompt, 8000, 'reconcileScenePlans');
  const parsed = parseJson(raw, 'reconcileScenePlans') as {
    revisions: { sceneId: string; revisedPlan: string; reason: string }[];
  };

  const result: Record<string, ReconcileRevision> = {};
  for (const rev of parsed.revisions ?? []) {
    if (rev.sceneId && rev.revisedPlan) {
      result[rev.sceneId] = { plan: rev.revisedPlan, reason: rev.reason ?? '' };
    }
  }
  return result;
}

export async function generateSceneProse(
  narrative: NarrativeState,
  scene: Scene,
  _sceneIndex: number,
  resolvedKeys: string[],
  onToken?: (token: string) => void,
): Promise<string> {

  // Branch context up to this scene — history without future details leaking in
  const sceneIdx = resolvedKeys.indexOf(scene.id);
  const contextIndex = sceneIdx >= 0 ? sceneIdx : resolvedKeys.length - 1;
  const fullContext = branchContext(narrative, resolvedKeys, contextIndex);

  // Adjacent scene prose for seamless transitions
  const prevSceneKey = sceneIdx > 0 ? resolvedKeys[sceneIdx - 1] : null;
  const prevScene = prevSceneKey ? narrative.scenes[prevSceneKey] : null;
  const prevProse = prevScene?.prose;
  const prevProseEnding = prevProse
    ? prevProse.split('\n').filter((l) => l.trim()).slice(-3).join('\n')
    : '';

  const nextSceneKey = sceneIdx < resolvedKeys.length - 1 ? resolvedKeys[sceneIdx + 1] : null;
  const nextScene = nextSceneKey ? narrative.scenes[nextSceneKey] : null;
  const nextProse = nextScene?.prose;
  const nextProseOpening = nextProse
    ? nextProse.split('\n').filter((l) => l.trim()).slice(0, 3).join('\n')
    : '';

  // Future scene summaries for foreshadowing (lightweight — summaries only, no prose)
  const futureKeys = resolvedKeys.slice(contextIndex + 1);
  const futureSummaries = futureKeys.length > 0
    ? futureKeys.map((k, i) => {
        const s = resolveEntry(narrative, k);
        if (!s || s.kind !== 'scene') return null;
        return `[+${i + 1}] ${s.summary}`;
      }).filter(Boolean).join('\n')
    : '';



  const systemPrompt = `You are a literary prose writer crafting a single scene for a novel set in "${narrative.title}".

Tone: ${narrative.worldSummary.slice(0, 200)}.

Voice & style:
- Third-person limited, locked to the POV character's senses and interiority. Their body, breath, and attention are the camera.
- Enter late, leave early. Start in the middle of something happening — never with setup or orientation.
- Let scenes breathe. Don't rush through structural beats. A thread shift or relationship change is a turning point — build to it, let it land, show the aftermath ripple through the character's body and thoughts.
- Dialogue must do at least two things at once: reveal character, advance conflict, shift power, or expose subtext. No filler exchanges. Each character should sound distinct — vocabulary, rhythm, what they avoid saying.
- Interiority through the body, not narration. Show the POV character's emotional state through physical sensation, impulse, and micro-action — not by naming emotions.
- Subtext over exposition. What characters don't say, what they notice but look away from, what they almost do — these carry more weight than declarations.
- Sensory grounding in small, specific details. One precise image beats three generic ones. Anchor abstract tension in concrete objects, textures, sounds.

Strict output rules:
- Output ONLY the prose. No scene titles, chapter headers, separators (---), or meta-commentary.
- Use straight quotes (" and '), never smart/curly quotes or other typographic substitutions.
- Do not begin with a character name as the first word.
- CRITICAL: Do NOT open with weather, atmosphere, air quality, scent, temperature, or environmental description. These are the most overused openings in fiction. Instead, choose from techniques like: mid-dialogue, a character's body in motion, a close-up on an object, an internal thought, a sound, a question, a tactile sensation, noticing someone's expression, or a punchy declarative sentence.
- Do NOT end with philosophical musings, rhetorical questions, or atmospheric fade-outs. Instead end with: a character leaving, a sharp line of dialogue, a decision made in silence, an interruption, a physical gesture, or a thought that reframes the scene.`;

  const sceneBlock = sceneContext(narrative, scene);

  // Scene plan — when available, this is the primary creative direction
  const planBlock = scene.plan
    ? `\nSCENE PLAN (follow this blueprint closely — it specifies beat-by-beat staging, discovery mechanisms, and dialogue seeds):\n${scene.plan}\n`
    : '';

  // Derive logical constraints from the scene graph — these are hard rules the prose must obey
  const logicRules = deriveLogicRules(narrative, scene);
  const logicBlock = logicRules.length > 0
    ? `\nLOGICAL REQUIREMENTS (these are hard constraints derived from the scene graph — violating any is a failure):\n${logicRules.map((r) => `  - ${r}`).join('\n')}\n`
    : '';

  // Adjacent prose edges for transition continuity
  const adjacentProseBlock = [
    prevProseEnding ? `PREVIOUS SCENE ENDING (match tone, avoid repeating imagery or phrasing):\n"""${prevProseEnding}"""` : '',
    nextProseOpening ? `NEXT SCENE OPENING (your ending should flow naturally into this):\n"""${nextProseOpening}"""` : '',
  ].filter(Boolean).join('\n\n');

  const scale = sceneScale(scene);

  const instruction = scene.plan
    ? `Follow the scene plan's beat sequence — it specifies the concrete mechanisms for every mutation. The structural data below is for verification: every thread shift, knowledge change, and relationship mutation must appear in the prose. You MUST satisfy every logical requirement. Fill around the planned beats with extended dialogue, internal monologue, physical action, and sensory detail. Let scenes breathe. Foreshadow future events through subtle imagery — never telegraph. Write as many words as the scene demands — a quiet scene with few beats may need only 800 words, a dense convergence scene may need 3000+. Err on the side of brevity for engagement; never pad.`
    : `Every thread shift, knowledge change, and relationship mutation listed above must be dramatised — these are the structural beats of this scene. You MUST satisfy every logical requirement listed above — these encode spatial constraints, POV discipline, knowledge asymmetry, relationship valence, and temporal ordering derived from the scene graph. Fill around them with extended dialogue exchanges, internal monologue, physical action, environmental detail, and character interaction. Let scenes breathe. Foreshadow future events through subtle imagery, offhand remarks, and environmental details — never telegraph. Write as many words as the scene demands — a quiet scene with few beats may need only 800 words, a dense convergence scene may need 3000+. Err on the side of brevity for engagement; never pad.`;

  const prompt = `BRANCH CONTEXT (for continuity — do not summarise or repeat this):
${fullContext}
${futureSummaries ? `\nFUTURE SCENES (for foreshadowing only — plant subtle seeds, never spoil or reference directly):\n${futureSummaries}\n` : ''}
${adjacentProseBlock ? `${adjacentProseBlock}\n\n` : ''}${planBlock}${sceneBlock}
${logicBlock}
${instruction}`;

  if (onToken) {
    return await callGenerateStream(prompt, systemPrompt, onToken, scale.proseTokens, 'generateSceneProse');
  }
  return await callGenerate(prompt, systemPrompt, scale.proseTokens, 'generateSceneProse');
}



/** Deterministically derive logical rules from the scene graph — no LLM needed.
 *  Returns plain-text rules the prose must obey (spatial, POV, knowledge, relationships, threads). */
function deriveLogicRules(narrative: NarrativeState, scene: Scene): string[] {
  const rules: string[] = [];

  const participantNames = scene.participantIds
    .map((pid) => narrative.characters[pid]?.name)
    .filter(Boolean);
  const participantIdSet = new Set(scene.participantIds);
  const location = narrative.locations[scene.locationId];
  const pov = narrative.characters[scene.povId];

  // Spatial: only participants can appear
  if (participantNames.length > 0 && location) {
    const absentNames = Object.values(narrative.characters)
      .filter((c) => !participantIdSet.has(c.id))
      .map((c) => c.name)
      .slice(0, 3);
    if (absentNames.length > 0) {
      rules.push(`Only these characters are present at ${location.name}: ${participantNames.join(', ')}. No other characters (e.g. ${absentNames.join(', ')}) may physically appear, speak, or interact.`);
    }
  }

  // POV constraint
  if (pov) {
    const otherParticipants = scene.participantIds
      .filter((pid) => pid !== scene.povId)
      .map((pid) => narrative.characters[pid]?.name)
      .filter(Boolean);
    if (otherParticipants.length > 0) {
      rules.push(`POV is locked to ${pov.name}. Do not reveal the internal thoughts, feelings, or private knowledge of ${otherParticipants.join(', ')} — only what ${pov.name} can observe, hear, or infer.`);
    }
  }

  // ── POV knowledge boundary ──────────────────────────────────────────
  // The POV character's knowledge graph is the hard boundary for narration.
  // The narrator cannot reference, explain, or react to information the POV
  // character does not possess — even indirectly through tone or framing.
  if (pov) {
    const povKnowledgeIds = new Set(pov.knowledge.nodes.map((kn) => kn.id));
    // Knowledge being added to POV this scene — they don't have it at the START
    const povLearnsThisScene = new Set(
      scene.knowledgeMutations
        .filter((km) => km.characterId === pov.id && km.action === 'added')
        .map((km) => km.nodeId),
    );
    // POV's knowledge at scene START = current graph - things learned this scene
    // (current graph already includes this scene's mutations since they've been applied)
    const povStartKnowledge = pov.knowledge.nodes.filter(
      (kn) => !povLearnsThisScene.has(kn.id),
    );

    // Summarize what POV knows at scene start (cap to avoid bloat)
    const MAX_POV_KNOWLEDGE_RULES = 8;
    const knowledgeSummary = povStartKnowledge.slice(-MAX_POV_KNOWLEDGE_RULES);
    if (knowledgeSummary.length > 0) {
      rules.push(`${pov.name}'s knowledge at scene start (narration is limited to this): ${knowledgeSummary.map((kn) => `"${kn.content}"`).join(', ')}${povStartKnowledge.length > MAX_POV_KNOWLEDGE_RULES ? ` (and ${povStartKnowledge.length - MAX_POV_KNOWLEDGE_RULES} earlier items)` : ''}. The narrator must NOT reference, explain, or frame events using information outside this set.`);
    }

    // Flag knowledge that other participants have but POV does NOT
    for (const pid of scene.participantIds) {
      if (pid === pov.id) continue;
      const other = narrative.characters[pid];
      if (!other) continue;
      const otherExclusive = other.knowledge.nodes.filter(
        (kn) => !povKnowledgeIds.has(kn.id) && !povLearnsThisScene.has(kn.id),
      );
      if (otherExclusive.length > 0) {
        const examples = otherExclusive.slice(-3).map((kn) => `"${kn.content}"`).join(', ');
        rules.push(`${other.name} knows things ${pov.name} does NOT: ${examples}${otherExclusive.length > 3 ? ` (and ${otherExclusive.length - 3} more)` : ''}. The narrator must NOT reveal, hint at, or frame ${other.name}'s actions using this hidden knowledge. ${pov.name} can only observe ${other.name}'s external behaviour and draw their own (possibly wrong) conclusions.`);
      }
    }
  }

  // Knowledge mutations — temporal ordering within this scene
  for (const km of scene.knowledgeMutations) {
    if (km.action !== 'added') continue;
    const char = narrative.characters[km.characterId];
    if (!char) continue;
    if (km.characterId === scene.povId) {
      rules.push(`${char.name} (POV) does NOT know "${km.content}" at scene start — they learn it during the scene. Before the discovery moment, the narrator must not reference this information even obliquely. Show genuine surprise/realisation, not dramatic irony.`);
    } else {
      rules.push(`${char.name} does NOT know "${km.content}" at scene start — they learn it during the scene. Since POV is ${pov?.name ?? 'another character'}, show this discovery only through ${char.name}'s observable reaction (expression, body language, dialogue), not through their inner thoughts.`);
    }
  }

  // Relationship valence consistency — compute PRE-scene valence by subtracting this scene's deltas
  const mutationDeltaMap = new Map<string, number>();
  for (const rm of scene.relationshipMutations) {
    const key = `${rm.from}->${rm.to}`;
    mutationDeltaMap.set(key, (mutationDeltaMap.get(key) ?? 0) + rm.valenceDelta);
  }

  const participantRelationships = narrative.relationships.filter(
    (r) => participantIdSet.has(r.from) && participantIdSet.has(r.to),
  );
  for (const r of participantRelationships) {
    const fromName = narrative.characters[r.from]?.name;
    const toName = narrative.characters[r.to]?.name;
    if (!fromName || !toName) continue;

    // Pre-scene valence = current valence minus any deltas applied by this scene
    const key = `${r.from}->${r.to}`;
    const delta = mutationDeltaMap.get(key) ?? 0;
    const preSceneValence = Math.round((r.valence - delta) * 100) / 100;

    // Skip edges that have mutations — the relationship mutation rules below handle those
    if (delta !== 0) continue;

    if (preSceneValence <= -0.5) {
      rules.push(`${fromName} → ${toName} relationship is hostile (valence ${preSceneValence}). Their interaction must reflect animosity, distrust, or conflict — no friendly or warm exchanges.`);
    } else if (preSceneValence <= -0.1) {
      rules.push(`${fromName} → ${toName} relationship is tense (valence ${preSceneValence}). Their interaction should carry friction, wariness, or unease.`);
    }
  }

  // Thread temporal ordering
  for (const tm of scene.threadMutations) {
    const thread = narrative.threads[tm.threadId];
    if (!thread) continue;
    rules.push(`Thread "${thread.description}" is "${tm.from}" at scene start and must transition to "${tm.to}" during the scene. Do not begin with the thread already in its end state.`);
  }

  // Relationship mutations — include pre-scene valence for context
  for (const rm of scene.relationshipMutations) {
    const fromName = narrative.characters[rm.from]?.name;
    const toName = narrative.characters[rm.to]?.name;
    if (!fromName || !toName) continue;
    const edge = narrative.relationships.find((r) => r.from === rm.from && r.to === rm.to);
    const postValence = edge?.valence ?? 0;
    const preValence = Math.round((postValence - rm.valenceDelta) * 100) / 100;
    const delta = Math.round(rm.valenceDelta * 100) / 100;
    rules.push(`${fromName} → ${toName} starts at valence ${preValence} and shifts by ${delta >= 0 ? '+' : ''}${delta} (${rm.type}) to end at ${Math.round(postValence * 100) / 100}. The prose must dramatise this change — show the relationship starting at its initial state and the shift happening through behaviour, dialogue, or action.`);
  }

  // Events
  for (const event of scene.events) {
    rules.push(`The event "${event}" must occur in this scene.`);
  }

  // Character movement
  if (scene.characterMovements) {
    for (const [charId, locId] of Object.entries(scene.characterMovements)) {
      const char = narrative.characters[charId];
      const newLoc = narrative.locations[locId];
      if (!char || !newLoc) continue;
      rules.push(`${char.name} moves to ${newLoc.name} during this scene. They start at ${location?.name ?? 'the current location'} — show the transition, not them already at ${newLoc.name}.`);
    }
  }

  return rules;
}

// ── Prose Score & Rewrite ────────────────────────────────────────────────────

import type { ProseScore } from '@/types/narrative';

/**
 * Score and rewrite a scene's prose in a single LLM call.
 * The LLM first critiques the prose on 6 dimensions (1-10), then rewrites
 * it to address its own critique. Returns both the score and rewritten prose.
 * Users can call this repeatedly — each pass should improve the score.
 */
export async function scoreAndRewriteSceneProse(
  narrative: NarrativeState,
  scene: Scene,
  resolvedKeys: string[],
  currentProse: string,
): Promise<{ prose: string; score: ProseScore }> {
  const sceneIdx = resolvedKeys.indexOf(scene.id);
  const sceneBlock = sceneContext(narrative, scene);
  const logicRules = deriveLogicRules(narrative, scene);

  // Get neighboring prose for continuity
  const prevId = sceneIdx > 0 ? resolvedKeys[sceneIdx - 1] : null;
  const nextId = sceneIdx < resolvedKeys.length - 1 ? resolvedKeys[sceneIdx + 1] : null;
  const prevProse = prevId ? narrative.scenes[prevId]?.prose : null;
  const nextProse = nextId ? narrative.scenes[nextId]?.prose : null;
  const prevEnding = prevProse ? prevProse.split(/\n\n+/).slice(-1)[0]?.slice(-300) : null;
  const nextOpening = nextProse ? nextProse.split(/\n\n+/)[0]?.slice(0, 300) : null;

  const planBlock = scene.plan
    ? `\nSCENE PLAN (the rewrite must preserve this beat structure):\n${scene.plan}\n`
    : '';

  const logicBlock = logicRules.length > 0
    ? `\nLOGICAL CONSTRAINTS (all must be satisfied):\n${logicRules.map((r) => `  - ${r}`).join('\n')}\n`
    : '';

  const systemPrompt = `You are a literary editor and prose writer. Your task is to SCORE the prose, then REWRITE it to improve. You return ONLY valid JSON — no markdown, no commentary.

Voice & style for the rewrite:
- Third-person limited, locked to the POV character's senses and interiority.
- Prose should feel novelistic, not summarised. Dramatise through action, dialogue, and sensory texture.
- Favour subtext over exposition. Let tension live in what characters don't say.
- Match the tone and genre of the world: ${narrative.worldSummary.slice(0, 200)}.
- Use straight quotes (" and '), never smart/curly quotes.
- CRITICAL: Do NOT open with weather, atmosphere, scent, or environmental description.
- Do NOT end with philosophical musings, rhetorical questions, or atmospheric fade-outs.`;

  const prompt = `SCENE CONTEXT:
${sceneBlock}
${planBlock}${logicBlock}${prevEnding ? `\nPREVIOUS SCENE ENDING:\n"...${prevEnding}"\n` : ''}${nextOpening ? `\nNEXT SCENE OPENING:\n"${nextOpening}..."\n` : ''}

CURRENT PROSE:
${currentProse}

STEP 1: Score the prose on these 6 dimensions (1-10 each):
- voice: POV discipline, character distinctiveness, consistent narrative voice
- pacing: scene breathes, beats land with proper weight, no rushing or dragging
- dialogue: subtext-rich, character-specific speech patterns, no filler exchanges
- sensory: grounded in concrete physical detail, body-first interiority
- mutation_coverage: all thread shifts, knowledge changes, and relationship mutations are dramatised (not summarised)
- overall: holistic quality considering all dimensions

STEP 2: Rewrite the prose to address weaknesses identified in your scoring. Preserve all narrative beats, events, and plot points. The rewrite should feel like the same scene written better. Length should match the scene's needs — a quiet scene may be 800 words, a dense convergence scene 3000+. Err on the side of brevity for engagement; never pad. Do not artificially compress or expand the original — let the content dictate length.

Return JSON:
{
  "score": {
    "overall": 7,
    "voice": 8,
    "pacing": 6,
    "dialogue": 7,
    "sensory": 5,
    "mutation_coverage": 8
  },
  "prose": "the full rewritten prose text"
}`;

  const scale = sceneScale(scene);
  // Cannot stream since we need JSON parsed — use non-streaming call
  const raw = await callGenerate(prompt, systemPrompt, scale.proseTokens + 1000, 'scoreAndRewriteSceneProse');
  const parsed = parseJson(raw, 'scoreAndRewriteSceneProse') as { score: ProseScore; prose: string };

  return {
    score: parsed.score,
    prose: parsed.prose,
  };
}

export type ChartAnnotation = {
  sceneIndex: number;
  force: 'payoff' | 'change' | 'variety';
  label: string;
};

/**
 * Generate chart annotations for the force tracker.
 * The LLM analyzes the trajectory and returns specific scene-level annotations
 * that should appear on the charts at notable peaks, valleys, and inflection points.
 */
export async function generateChartAnnotations(
  narrative: NarrativeState,
  forceData: { sceneIndex: number; sceneId: string; arcName: string; forces: { payoff: number; change: number; variety: number }; corner: string; summary: string; threadChanges: string[]; location: string; participants: string[] }[],
): Promise<ChartAnnotation[]> {
  const trajectoryLines = forceData.map((d) => {
    const tc = d.threadChanges.length > 0 ? ` | ${d.threadChanges.join('; ')}` : '';
    return `[${d.sceneIndex + 1}] ${d.arcName} | ${d.corner} | P:${d.forces.payoff.toFixed(2)} C:${d.forces.change.toFixed(2)} V:${d.forces.variety.toFixed(2)} | @${d.location} | ${d.participants.join(', ')} | "${d.summary.slice(0, 80)}"${tc}`;
  }).join('\n');

  const systemPrompt = `You are a narrative analyst annotating force trajectory charts. Return ONLY valid JSON — no markdown, no code fences, no commentary.`;

  const prompt = `Analyze this narrative's force trajectory and generate annotations for notable moments.

NARRATIVE: "${narrative.title}" (${forceData.length} scenes)

SCENE-BY-SCENE DATA:
${trajectoryLines}

Annotate ONLY the peaks (local maxima) and troughs (local minima) of each force line. Look at the P/C/V values — find where each force hits its highest and lowest points, then label those.

Rules:
- ONLY peaks and troughs — nothing in between. If the value is rising or falling but hasn't reached an extremum, skip it.
- Include annotations for ALL THREE forces — payoff, change, AND variety
- ~4-6 annotations per force (the clearest peaks and troughs only)
- Labels: 2-5 words, specific to the story. Use character names, places, events.
- Never use generic labels like "high tension" or "calm period"
- Payoff peaks: danger, threats, betrayals. Troughs: safety, calm
- Change peaks: action bursts, dense reveals. Troughs: breathing room, reflection
- Variety peaks: new locations or characters (check @location and participants for first appearances). Troughs: same familiar cast/setting recurring

Return a JSON array:
[{"sceneIndex": 0, "force": "payoff", "label": "short annotation"}, ...]

sceneIndex is 0-based. force is one of: "payoff", "change", "variety".`;

  const raw = await callGenerate(prompt, systemPrompt, 4000, 'generateChartAnnotations');

  // Parse JSON from response, handling potential markdown fences
  const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (a: unknown): a is ChartAnnotation =>
      typeof a === 'object' && a !== null &&
      'sceneIndex' in a && 'force' in a && 'label' in a &&
      typeof (a as ChartAnnotation).sceneIndex === 'number' &&
      ['payoff', 'change', 'variety'].includes((a as ChartAnnotation).force) &&
      typeof (a as ChartAnnotation).label === 'string'
  );
}

export async function generateNarrative(
  title: string,
  premise: string,
  rules: string[] = [],
): Promise<NarrativeState> {
  const prompt = `Create a complete narrative world for:
Title: "${title}"
Premise: ${premise}

Return JSON with this exact structure:
{
  "worldSummary": "2-3 sentence world description",
  "characters": [
    {"id": "C-01", "name": "string", "role": "anchor|recurring|transient", "threadIds": ["T-01"], "imagePrompt": "1-2 sentence visual description of physical appearance, clothing, distinguishing features for portrait generation", "knowledge": {"nodes": [{"id": "K-01", "type": "specific_contextual_type", "content": "string"}]}}
  ],
  "locations": [
    {"id": "L-01", "name": "string", "parentId": null, "threadIds": [], "imagePrompt": "1-2 sentence visual description of architecture, landscape, atmosphere for establishing shot generation", "knowledge": {"nodes": [{"id": "LK-01", "type": "specific_contextual_type", "content": "string"}]}}
  ],
  "threads": [
    {"id": "T-01", "anchors": [{"id": "C-01", "type": "character"}], "description": "string", "status": "dormant", "openedAt": "S-001", "dependents": []}
  ],
  "relationships": [
    {"from": "C-01", "to": "C-02", "type": "description", "valence": 0.5}
  ],
  "scenes": [
    {
      "id": "S-001",
      "arcId": "ARC-01",
      "locationId": "L-01",
      "povId": "C-01",
      "participantIds": ["C-01"],
      "events": ["event_tag"],
      "threadMutations": [{"threadId": "T-01", "from": "dormant", "to": "active"}],
      "knowledgeMutations": [{"characterId": "C-XX", "nodeId": "K-GEN-001", "action": "added", "content": "what they learned", "nodeType": "a descriptive type for this knowledge"}],
      "relationshipMutations": [],
      "summary": "REQUIRED: 2-4 sentence vivid narrative summary of the scene"
    }
  ],
  "arcs": [
    {"id": "ARC-01", "name": "string", "sceneIds": ["S-001"], "develops": ["T-01"], "locationIds": ["L-01"], "activeCharacterIds": ["C-01"], "initialCharacterLocations": {"C-01": "L-01"}}
  ],
  "rules": ["World rule 1", "World rule 2"]
}

Generate a world with enough CRITICAL MASS to sustain a long-running story:
- 6-10 characters: at least 3 anchors, 3-4 recurring, 1-2 transient. Each with 4-8 knowledge nodes. Characters should have secrets, goals, beliefs, and tactical knowledge — not just surface-level facts.
- 6-10 locations with hierarchy (parent/child nesting). Each with 2-4 knowledge nodes describing lore, dangers, secrets, or resources. Locations should feel lived-in.
- 5-8 threads representing major narrative tensions, mysteries, and conflicts. Threads should interlock — at least some threads should share dependents or anchors.
- 8-10 relationships between characters. Relationships should be asymmetric (A→B differs from B→A) with specific, character-voice descriptions. Use valence to show warmth vs hostility.
- 15-25 scenes across 2-3 arcs. Each arc should have 5-10 scenes.

PACING IS CRITICAL:
- Do NOT rush through major plot beats. A story needs breathing room.
- Not every scene should advance the main plot. Include quiet scenes: character conversations, world exploration, daily life, travel, reflection.
- Only 1 in 3-4 scenes should be a significant plot event. The rest should build atmosphere, deepen relationships, or reveal character.
- Threads should stay dormant or slowly surface over multiple scenes before escalating. A thread going from dormant to escalating in 2 scenes is too fast.
- Think of pacing like a novel: setup → slow build → complication → breathing room → escalation. Not: event → event → event → event.
- Early scenes should establish normalcy and stakes before disrupting them.
- Thread statuses follow a lifecycle. ${THREAD_LIFECYCLE_DOC} When a thread's story reaches its conclusion, transition it to the appropriate terminal status.

Knowledge types must be SPECIFIC and CONTEXTUAL to the world — not generic labels like "knows" or "secret". Use types that describe exactly what kind of knowledge or lore this is (e.g. "cultivation_technique", "blood_debt", "prophecy_fragment", "territorial_claim", "hidden_identity"). Knowledge edge types should also be contextual: "enables", "contradicts", "unlocks", "corrupts", "conceals", "depends_on", etc.

Scene knowledgeMutations track what characters LEARN during a scene. Each mutation MUST have: characterId (who learned it), nodeId (unique ID like K-GEN-001), action ("added"), content (what they learned), nodeType (specific contextual type). The characterId must reference an existing character ID (C-XX).

WORLD RULES: Generate 4-6 world rules — absolute constraints that every scene must obey. These define the physics, magic system limits, social rules, or thematic laws of the world.${rules.length > 0 ? ` The user has already provided these rules — include them as-is and add more if appropriate:\n${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}` : ''}`;

  const raw = await callGenerate(prompt, SYSTEM_PROMPT, 60000, 'generateNarrative');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = parseJson(raw, 'generateNarrative') as any;
  console.log('[generateNarrative] parsed keys:', Object.keys(parsed));
  console.log('[generateNarrative] relationships count:', parsed.relationships?.length ?? 0);
  console.log('[generateNarrative] scenes count:', parsed.scenes?.length ?? 0);

  const now = Date.now();
  const id = `N-${now}`;

  const characters: NarrativeState['characters'] = {};
  for (const c of parsed.characters) characters[c.id] = c;

  const locations: NarrativeState['locations'] = {};
  for (const l of parsed.locations) locations[l.id] = l;

  const threads: NarrativeState['threads'] = {};
  for (const t of parsed.threads) threads[t.id] = t;

  const scenes: NarrativeState['scenes'] = {};
  for (const s of parsed.scenes) scenes[s.id] = { ...s, kind: 'scene', summary: s.summary || `Scene ${s.id}` };

  const arcs: NarrativeState['arcs'] = {};
  for (const a of parsed.arcs) arcs[a.id] = a;

  const branchId = `B-${now}`;
  const branches: NarrativeState['branches'] = {
    [branchId]: {
      id: branchId,
      name: 'Main',
      parentBranchId: null,
      forkEntryId: null,
      entryIds: Object.keys(scenes),
      createdAt: now,
    },
  };

  const sceneList = Object.values(scenes);

  const commits = sceneList.map((scene, i) => ({
    id: `CM-${String(i + 1).padStart(3, '0')}`,
    parentId: i === 0 ? null : `CM-${String(i).padStart(3, '0')}`,
    sceneId: scene.id,
    arcId: scene.arcId,
    diffName: scene.events[0] ?? 'scene',
    threadMutations: scene.threadMutations,
    knowledgeMutations: scene.knowledgeMutations,
    relationshipMutations: scene.relationshipMutations,
    authorOverride: null,
    createdAt: now - (sceneList.length - i) * 3600000,
  }));

  return {
    id,
    title,
    description: premise,
    characters,
    locations,
    threads,
    arcs,
    scenes,
    worldBuilds: {},
    branches,
    commits,
    relationships: parsed.relationships ?? [],
    worldSummary: parsed.worldSummary ?? premise,
    rules: Array.isArray(parsed.rules) ? parsed.rules.filter((r: unknown) => typeof r === 'string') : rules,
    controlMode: 'auto',
    activeForces: { payoff: 0, change: 0, variety: 0 },
    createdAt: now,
    updatedAt: now,
  };
}
