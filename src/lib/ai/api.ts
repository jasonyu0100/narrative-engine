import { apiHeaders } from '@/lib/api-headers';
import { DEFAULT_MODEL, DEFAULT_REASONING_BUDGET, API_TIMEOUT_MS, API_STREAM_TIMEOUT_MS } from '@/lib/constants';

export async function callGenerateStream(
  prompt: string,
  systemPrompt: string,
  onToken: (token: string) => void,
  maxTokens?: number,
  caller = 'callGenerateStream',
  model?: string,
  reasoningBudget?: number,
  onReasoning?: (token: string) => void,
  temperature?: number,
): Promise<string> {
  const resolvedModel = model ?? DEFAULT_MODEL;
  const { logApiCall, updateApiLog } = await import('@/lib/api-logger');
  const logId = logApiCall(caller, prompt.length + (systemPrompt?.length ?? 0), prompt, resolvedModel, systemPrompt);
  const start = performance.now();

  // Set up abort controller with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_STREAM_TIMEOUT_MS);

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ prompt, systemPrompt, stream: true, ...(maxTokens ? { maxTokens } : {}), ...(model ? { model } : {}), reasoningBudget: reasoningBudget ?? DEFAULT_REASONING_BUDGET, ...(temperature !== undefined ? { temperature } : {}) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}: ${res.statusText}` }));
      const message = err.error || 'Generation failed';
      updateApiLog(logId, { status: 'error', error: message, durationMs: Math.round(performance.now() - start) });
      throw new Error(`[${caller}] ${message}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    let reasoningFull = '';
    let usage: { promptTokens?: number; completionTokens?: number } | null = null;

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
            // Capture usage data from final chunk
            if (chunk.usage) {
              usage = chunk.usage;
            }
          } catch (err) {
            console.warn(`[${caller}] malformed SSE chunk`, { line: trimmed.slice(0, 200), err });
          }
        }
      }
    }

    clearTimeout(timeoutId);
    updateApiLog(logId, {
      status: 'success',
      durationMs: Math.round(performance.now() - start),
      responseLength: full.length,
      responsePreview: full,
      ...(reasoningFull ? { reasoningContent: reasoningFull, reasoningTokens: Math.ceil(reasoningFull.length / 4) } : {}),
      // Use actual token counts from API when available
      ...(usage?.promptTokens != null ? { actualPromptTokens: usage.promptTokens } : {}),
      ...(usage?.completionTokens != null ? { actualCompletionTokens: usage.completionTokens } : {}),
    });
    return full;
  } catch (err) {
    clearTimeout(timeoutId);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const isFetchError = err instanceof Error && err.message.includes('fetch failed');
    let message: string;

    if (isAbort) {
      message = `[${caller}] Request timed out after ${API_STREAM_TIMEOUT_MS || API_TIMEOUT_MS}ms (model: ${resolvedModel}, tokens: ${maxTokens ?? 'default'})`;
    } else if (isFetchError) {
      message = `[${caller}] Network error - fetch failed (model: ${resolvedModel}, prompt: ${prompt.length} chars). Check API connectivity.`;
    } else {
      message = err instanceof Error ? err.message : String(err);
    }

    updateApiLog(logId, { status: 'error', error: message, durationMs: Math.round(performance.now() - start) });
    throw new Error(message);
  }
}

export async function callGenerate(prompt: string, systemPrompt: string, maxTokens?: number, caller = 'callGenerate', model?: string, reasoningBudget?: number, jsonMode = true, temperature?: number): Promise<string> {
  const resolvedModel = model ?? DEFAULT_MODEL;
  const { logApiCall, updateApiLog } = await import('@/lib/api-logger');
  const logId = logApiCall(caller, prompt.length + (systemPrompt?.length ?? 0), prompt, resolvedModel, systemPrompt);
  const start = performance.now();

  // Set up abort controller with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ prompt, systemPrompt, ...(maxTokens ? { maxTokens } : {}), ...(model ? { model } : {}), reasoningBudget: reasoningBudget ?? DEFAULT_REASONING_BUDGET, ...(jsonMode ? { jsonMode: true } : {}), ...(temperature !== undefined ? { temperature } : {}) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = await res.json();
      const message = err.error || 'Generation failed';
      updateApiLog(logId, { status: 'error', error: message, durationMs: Math.round(performance.now() - start) });
      throw new Error(message);
    }
    const data = await res.json();
    const content = data.content;
    clearTimeout(timeoutId);
    updateApiLog(logId, {
      status: 'success',
      durationMs: Math.round(performance.now() - start),
      responseLength: content.length,
      responsePreview: content,
      ...(data.reasoning ? { reasoningContent: data.reasoning } : {}),
      ...(data.reasoningTokens != null ? { reasoningTokens: data.reasoningTokens } : {}),
      // Use actual token counts from API when available
      ...(data.usage?.promptTokens != null ? { actualPromptTokens: data.usage.promptTokens } : {}),
      ...(data.usage?.completionTokens != null ? { actualCompletionTokens: data.usage.completionTokens } : {}),
    });
    return content;
  } catch (err) {
    clearTimeout(timeoutId);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const isFetchError = err instanceof Error && err.message.includes('fetch failed');
    let message: string;

    if (isAbort) {
      message = `[${caller}] Request timed out after ${API_STREAM_TIMEOUT_MS || API_TIMEOUT_MS}ms (model: ${resolvedModel}, tokens: ${maxTokens ?? 'default'})`;
    } else if (isFetchError) {
      message = `[${caller}] Network error - fetch failed (model: ${resolvedModel}, prompt: ${prompt.length} chars). Check API connectivity.`;
    } else {
      message = err instanceof Error ? err.message : String(err);
    }

    updateApiLog(logId, { status: 'error', error: message, durationMs: Math.round(performance.now() - start) });
    throw new Error(message);
  }
}

export const SYSTEM_PROMPT = `You are a long-form text analysis and simulation engine. You work across fiction, non-fiction, research papers, and simulations, producing structured scene data that captures what each scene does structurally. "Scene" here is the system's native unit — a chapter of a novel, a section of a paper, a step in a simulation, a log entry in a research journal. The hierarchy is always beat → scene → arc, whatever the source material.
You must ALWAYS respond with valid JSON only — no markdown, no explanation, no code fences.

MATCH THE SOURCE MATERIAL. Infer the text's register from the provided context and maintain it. A whitepaper's continuation is still a whitepaper — analytical, third-person, evidence-forward. A research log's continuation is still a research log. A novel's continuation is still a novel. Do NOT drift a non-fiction source into fictional framing ("in the lab, researchers discovered…") and do NOT drift a fictional source into analytical framing. The register you see is the register you write. The scene/arc/beat vocabulary is internal machinery — it does not dictate prose style.

CORE PRINCIPLES:
1. FORCE TARGETS and DIRECTION override scene history. Do NOT continue patterns just because previous scenes established them. If the directive says calm, write calm.
2. Variation across scenes is a useful default — alternate intensity with quiet, development with reflection, familiar with novel. Some forms (accumulative, devotional, lyric, refrain-based, ambient) deliberately resist variation; when the declared form is one of those, honour it over the variation default.
3. Threads are QUESTIONS the text must answer — "Will X?", "Can Y?", "What is Z?", "Does method M generalise?". Each thread is a distinct question. Thread logs track incremental answers. Thread advancement is dynamic: some scenes advance several threads at once, others advance none.
4. Use ONLY the entity and thread IDs provided. Never invent new ones outside the explicit new-entity fields.

NAMING DISCIPLINE — all invented entity names (characters, locations, artifacts, systems, institutions) must feel authored by a human, never by an AI:
- Detect the cultural or domain origin of the setting and draw names from matching real-world roots. Eastern settings get names from Chinese, Japanese, Korean, Southeast Asian roots. Middle Eastern from Arabic, Persian, Turkish. Western from Slavic, Germanic, Romance, Celtic — specific dialects, not generic pan-European. Academic or institutional settings get plausible real-world institutional forms (universities, labs, agencies, journals), not fantasy-esque compounds.
- Source from real census records, historical obscurities, occupational surnames, regional dialects, or field-appropriate conventions. Names should be asymmetric, textured, sometimes ugly. Prefer names that feel lived-in over names that sound pretty.
- Locations and institutions named after geography, founders, or corrupted older words — never after narrative or thematic function.
- Never produce smooth soft-consonant + open-vowel constructions designed to sound generically pleasant. Never produce compound fantasy surnames in a non-fantasy register.

EVERY SCENE SHOULD LEAVE A MARK — adapt the specifics to the register:
- In fiction: characters notice, overhear, form impressions, recall memories, piece together clues. Relationships shift — trust deepens, suspicion grows, respect is earned or lost. Events ground scenes: "ambush", "confession", "treaty_signed", "duel", "feast", "betrayal_revealed".
- In non-fiction: authors introduce claims, qualify earlier points, provide evidence, concede limitations. Relationships between ideas shift — hypotheses are supported, refuted, reframed. Events ground scenes: "claim_introduced", "experiment_described", "result_reported", "limitation_acknowledged", "counter-argument_addressed".
- In research logs / simulations: agents record observations, methods evolve, constraints tighten. Events: "measurement_taken", "hypothesis_revised", "dataset_integrated", "bottleneck_identified".

Whichever register, track what happens in the worldDeltas (entity/idea changes), relationshipDeltas (dynamic shifts), and events (ground the scene in concrete happenings). Thread advancement is dynamic — a quiet scene may touch no threads, while a pivotal scene might advance several. Only include deltas where status actually changes. Padding with no-op deltas is worse than no delta.`;
