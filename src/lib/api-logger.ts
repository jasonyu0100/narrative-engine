import type { ApiLogEntry } from '@/types/narrative';

type LogListener = (entry: ApiLogEntry) => void;
type UpdateListener = (id: string, updates: Partial<ApiLogEntry>) => void;

let logListener: LogListener | null = null;
let updateListener: UpdateListener | null = null;

let counter = 0;

export function onApiLog(listener: LogListener) {
  logListener = listener;
}

export function onApiLogUpdate(listener: UpdateListener) {
  updateListener = listener;
}

/** Estimate token count from character length (~4 chars per token for English) */
const estimateTokens = (chars: number) => Math.ceil(chars / 4);

export function logApiCall(caller: string, promptChars: number, promptPreview: string): string {
  const id = `api-${Date.now()}-${counter++}`;
  const entry: ApiLogEntry = {
    id,
    timestamp: Date.now(),
    caller,
    status: 'pending',
    durationMs: null,
    promptTokens: estimateTokens(promptChars),
    responseTokens: null,
    error: null,
    promptPreview: promptPreview,
    responsePreview: null,
  };
  logListener?.(entry);
  return id;
}

/** Callers pass responseLength in chars — converted to tokens here */
type ApiLogUpdate = Omit<Partial<ApiLogEntry>, 'responseTokens'> & { responseLength?: number };

export function updateApiLog(id: string, updates: ApiLogUpdate) {
  const { responseLength, ...rest } = updates;
  const mapped: Partial<ApiLogEntry> = { ...rest };
  if (responseLength != null) mapped.responseTokens = estimateTokens(responseLength);
  updateListener?.(id, mapped);
}
