import type { ApiLogEntry } from '@/types/narrative';

type LogListener = (entry: ApiLogEntry) => void;
type UpdateListener = (id: string, updates: Partial<ApiLogEntry>) => void;

let logListener: LogListener | null = null;
let updateListener: UpdateListener | null = null;
let activeNarrativeId: string | null = null;
let activeAnalysisJobId: string | null = null;

let counter = 0;

export function onApiLog(listener: LogListener) {
  logListener = listener;
}

export function onApiLogUpdate(listener: UpdateListener) {
  updateListener = listener;
}

/** Called by the store when the active narrative changes */
export function setLoggerNarrativeId(id: string | null) {
  activeNarrativeId = id;
}

/** Called by analysis runner when an analysis job starts/ends */
export function setLoggerAnalysisJobId(id: string | null) {
  activeAnalysisJobId = id;
}

/** Estimate token count from character length (~4 chars per token for English) */
const estimateTokens = (chars: number) => Math.ceil(chars / 4);

/**
 * Calculate cost for an API call based on model and token usage.
 * Prices are approximate and based on current OpenRouter pricing (as of 2025).
 */
export function calculateApiCost(entry: ApiLogEntry): number {
  if (!entry.model) return 0;

  // Replicate models (images) - flat rate
  if (entry.model.startsWith('replicate/')) {
    return 0.04; // $0.04 per image generation
  }

  const inputTokens = entry.promptTokens ?? 0;
  const outputTokens = (entry.responseTokens ?? 0) + (entry.reasoningTokens ?? 0);

  // Gemini pricing (per million tokens)
  if (entry.model.includes('gemini-2.5-flash')) {
    // Gemini 2.5 Flash: $0.10/M input, $0.40/M output
    return (inputTokens * 0.10 + outputTokens * 0.40) / 1_000_000;
  }
  if (entry.model.includes('gemini-3-flash')) {
    // Gemini 3 Flash Preview: $0.15/M input, $0.60/M output (estimated)
    return (inputTokens * 0.15 + outputTokens * 0.60) / 1_000_000;
  }
  if (entry.model.includes('gemini-2.0-flash-thinking')) {
    // Gemini 2.0 Flash Thinking: $0.10/M input, $0.40/M output, $0.40/M reasoning
    return (inputTokens * 0.10 + outputTokens * 0.40) / 1_000_000;
  }

  // Claude pricing
  if (entry.model.includes('claude-3-5-sonnet') || entry.model.includes('claude-sonnet-4')) {
    // Claude Sonnet: $3/M input, $15/M output
    return (inputTokens * 3 + outputTokens * 15) / 1_000_000;
  }
  if (entry.model.includes('claude-3-5-haiku')) {
    // Claude Haiku: $0.80/M input, $4/M output
    return (inputTokens * 0.80 + outputTokens * 4) / 1_000_000;
  }
  if (entry.model.includes('claude-opus-4')) {
    // Claude Opus 4: $15/M input, $75/M output
    return (inputTokens * 15 + outputTokens * 75) / 1_000_000;
  }

  // Default fallback (assume similar to Gemini Flash)
  return (inputTokens * 0.10 + outputTokens * 0.40) / 1_000_000;
}

/**
 * Calculate total cost for a set of API log entries
 */
export function calculateTotalCost(entries: ApiLogEntry[]): number {
  return entries.reduce((sum, entry) => sum + calculateApiCost(entry), 0);
}

export function logApiCall(caller: string, promptChars: number, promptPreview: string, model?: string, systemPromptPreview?: string): string {
  const id = `api-${Date.now()}-${counter++}`;
  const entry: ApiLogEntry = {
    id,
    timestamp: Date.now(),
    caller,
    model,
    narrativeId: activeNarrativeId ?? undefined,
    analysisJobId: activeAnalysisJobId ?? undefined,
    status: 'pending',
    durationMs: null,
    promptTokens: estimateTokens(promptChars),
    responseTokens: null,
    error: null,
    systemPromptPreview,
    promptPreview: promptPreview,
    responsePreview: null,
  };
  logListener?.(entry);
  return id;
}

/** Callers pass responseLength in chars — converted to tokens here */
type ApiLogUpdate = Omit<Partial<ApiLogEntry>, 'responseTokens'> & { responseLength?: number; reasoningContent?: string; reasoningTokens?: number };

export function updateApiLog(id: string, updates: ApiLogUpdate) {
  const { responseLength, reasoningContent, reasoningTokens, ...rest } = updates;
  const mapped: Partial<ApiLogEntry> = { ...rest };
  if (responseLength != null) mapped.responseTokens = estimateTokens(responseLength);
  if (reasoningContent != null) mapped.reasoningContent = reasoningContent;
  if (reasoningTokens != null) mapped.reasoningTokens = reasoningTokens;
  updateListener?.(id, mapped);
}
