import type { ApiLogEntry } from '@/types/narrative';
import { MODEL_PRICING, DEFAULT_PRICING } from '@/lib/constants';

type LogListener = (entry: ApiLogEntry) => void;
type UpdateListener = (id: string, updates: Partial<ApiLogEntry>) => void;

let logListener: LogListener | null = null;
let updateListener: UpdateListener | null = null;
let activeNarrativeId: string | null = null;
let activeAnalysisId: string | null = null;
let activeDiscoveryId: string | null = null;

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

/** Called by analysis runner when an analysis starts/ends */
export function setLoggerAnalysisId(id: string | null) {
  activeAnalysisId = id;
}

/** Called when a discovery session starts/ends */
export function setLoggerDiscoveryId(id: string | null) {
  activeDiscoveryId = id;
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

  // Look up pricing from constants, fall back to default
  const pricing = MODEL_PRICING[entry.model] ?? DEFAULT_PRICING;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
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
    analysisId: activeAnalysisId ?? undefined,
    discoveryId: activeDiscoveryId ?? undefined,
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

/** Callers pass responseLength in chars — converted to tokens here, or actual token counts when available */
type ApiLogUpdate = Omit<Partial<ApiLogEntry>, 'responseTokens' | 'promptTokens'> & {
  responseLength?: number;
  reasoningContent?: string;
  reasoningTokens?: number;
  actualPromptTokens?: number;
  actualCompletionTokens?: number;
};

export function updateApiLog(id: string, updates: ApiLogUpdate) {
  const { responseLength, reasoningContent, reasoningTokens, actualPromptTokens, actualCompletionTokens, ...rest } = updates;
  const mapped: Partial<ApiLogEntry> = { ...rest };
  // Use actual token counts from API when available, fall back to estimates
  if (actualPromptTokens != null) mapped.promptTokens = actualPromptTokens;
  if (actualCompletionTokens != null) {
    mapped.responseTokens = actualCompletionTokens;
  } else if (responseLength != null) {
    mapped.responseTokens = estimateTokens(responseLength);
  }
  if (reasoningContent != null) mapped.reasoningContent = reasoningContent;
  if (reasoningTokens != null) mapped.reasoningTokens = reasoningTokens;
  updateListener?.(id, mapped);
}
