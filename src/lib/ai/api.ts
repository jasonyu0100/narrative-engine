import { apiHeaders } from '@/lib/api-headers';
import { DEFAULT_MODEL, DEFAULT_REASONING_BUDGET } from '@/lib/constants';

export async function callGenerateStream(
  prompt: string,
  systemPrompt: string,
  onToken: (token: string) => void,
  maxTokens?: number,
  caller = 'callGenerateStream',
  model?: string,
  reasoningBudget?: number,
  onReasoning?: (token: string) => void,
): Promise<string> {
  const resolvedModel = model ?? DEFAULT_MODEL;
  const { logApiCall, updateApiLog } = await import('@/lib/api-logger');
  const logId = logApiCall(caller, prompt.length + (systemPrompt?.length ?? 0), prompt, resolvedModel);
  const start = performance.now();

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ prompt, systemPrompt, stream: true, ...(maxTokens ? { maxTokens } : {}), ...(model ? { model } : {}), reasoningBudget: reasoningBudget ?? DEFAULT_REASONING_BUDGET }),
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
    let reasoningFull = '';

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
            const reasoning = chunk.reasoning ?? '';
            if (reasoning) {
              reasoningFull += reasoning;
              onReasoning?.(reasoning);
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
      ...(reasoningFull ? { reasoningContent: reasoningFull, reasoningTokens: Math.ceil(reasoningFull.length / 4) } : {}),
    });
    return full;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateApiLog(logId, { status: 'error', error: message, durationMs: Math.round(performance.now() - start) });
    throw err;
  }
}

export async function callGenerate(prompt: string, systemPrompt: string, maxTokens?: number, caller = 'callGenerate', model?: string, reasoningBudget?: number, jsonMode = true): Promise<string> {
  const resolvedModel = model ?? DEFAULT_MODEL;
  const { logApiCall, updateApiLog } = await import('@/lib/api-logger');
  const logId = logApiCall(caller, prompt.length + (systemPrompt?.length ?? 0), prompt, resolvedModel);
  const start = performance.now();

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ prompt, systemPrompt, ...(maxTokens ? { maxTokens } : {}), ...(model ? { model } : {}), reasoningBudget: reasoningBudget ?? DEFAULT_REASONING_BUDGET, ...(jsonMode ? { jsonMode: true } : {}) }),
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
      ...(data.reasoning ? { reasoningContent: data.reasoning } : {}),
      ...(data.reasoningTokens != null ? { reasoningTokens: data.reasoningTokens } : {}),
    });
    return content;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateApiLog(logId, { status: 'error', error: message, durationMs: Math.round(performance.now() - start) });
    throw err;
  }
}

export const SYSTEM_PROMPT = `You are a narrative simulation engine that generates structured scene data for interactive storytelling.
You must ALWAYS respond with valid JSON only — no markdown, no explanation, no code fences.

CORE PRINCIPLES:
1. FORCE TARGETS and DIRECTION override scene history. Do NOT continue patterns just because previous scenes established them. If the directive says calm, write calm.
2. High swing is the north star of compelling narrative. Consecutive scenes should feel dynamically different — alternate intensity with quiet, action with reflection, familiar with surprising.
3. Threads are DISTINCT narrative tensions — each one should be genuinely different from every other. Thread advancement is dynamic: some scenes advance several threads at once, others advance none. Let the story dictate the rhythm.
4. Use ONLY the character, location, and thread IDs provided. Never invent new ones.

NAMING DISCIPLINE — all entity names (characters, locations, artifacts, systems) must feel authored by a human novelist, never by an AI:
- Detect the cultural origin of the world and draw names from matching real-world linguistic roots. Eastern worlds get names sourced from Chinese, Japanese, Korean, Southeast Asian roots. Middle Eastern worlds from Arabic, Persian, Turkish roots. Western from Slavic, Germanic, Romance, Celtic roots — but SPECIFIC dialects, not generic pan-European. Multicultural worlds should have distinct naming palettes per faction or region.
- Source from real census records, historical obscurities, occupational surnames, or regional dialects. Names should be asymmetric, textured, and sometimes ugly. Prefer names that feel lived-in over names that sound pretty.
- Locations named after geography, founders, or corrupted older words — never after narrative function.
- Never produce smooth soft-consonant + open-vowel constructions designed to sound generically pleasant. Never produce compound fantasy surnames.

WRITING LIKE A NOVELIST — every scene should leave a mark:
- Characters are always learning. In every scene, someone notices something, overhears a detail, forms an impression, recalls a memory, or pieces together a clue. Track these as continuityMutations — they are the fabric of dramatic irony and character interiority.
- Relationships shift constantly. When characters interact, their dynamics evolve — trust deepens, suspicion grows, respect is earned or lost. Even a shared glance or an awkward silence shifts something. Track these as relationshipMutations with appropriate valenceDelta.
- Events ground scenes in concrete happenings. Tag what actually occurs: "ambush", "confession", "storm_arrival", "treaty_signed", "duel", "feast", "betrayal_revealed". These make scenes feel like real narrative moments, not abstract summaries.
- Thread advancement is dynamic — a quiet scene may touch no threads, while a pivotal scene might advance several at once. Only include mutations where the status actually changes. Padding with no-op mutations is worse than no mutation at all.`;
