import type { ErrorLogEntry } from '@/types/narrative';

type LogListener = (entry: ErrorLogEntry) => void;

let logListener: LogListener | null = null;
let activeNarrativeId: string | null = null;
let activeAnalysisId: string | null = null;
let activeDiscoveryId: string | null = null;

let counter = 0;

export function onErrorLog(listener: LogListener) {
  logListener = listener;
}

/** Called by the store when the active narrative changes */
export function setErrorLoggerNarrativeId(id: string | null) {
  activeNarrativeId = id;
}

/** Called by analysis runner when an analysis starts/ends */
export function setErrorLoggerAnalysisId(id: string | null) {
  activeAnalysisId = id;
}

/** Called when a discovery session starts/ends */
export function setErrorLoggerDiscoveryId(id: string | null) {
  activeDiscoveryId = id;
}

export type ErrorContext = {
  /** Where the error occurred (e.g., 'auto-play', 'mcts', 'manual-generation', 'analysis') */
  source: 'auto-play' | 'mcts' | 'manual-generation' | 'analysis' | 'world-expansion' | 'direction-generation' | 'prose-generation' | 'plan-generation' | 'other';
  /** Current operation when error occurred */
  operation?: string;
  /** Additional context (e.g., phase name, scene count, model used) */
  details?: Record<string, string | number | boolean | null | undefined>;
};

export function logError(
  message: string,
  error: Error | string | unknown,
  context: ErrorContext,
  severity: 'error' | 'warning' = 'error'
): string {
  const id = `err-${Date.now()}-${counter++}`;

  const errorMsg = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  // Categorize error type
  const isFetchError = errorMsg.includes('fetch failed');
  const isTimeout = errorMsg.includes('timed out') || errorMsg.includes('timeout');
  const isJSON = errorMsg.includes('JSON') || errorMsg.includes('parse');
  const isValidation = errorMsg.includes('invalid') || errorMsg.includes('validation');
  const isNetwork = isFetchError || errorMsg.includes('network') || errorMsg.includes('ECONNREFUSED');

  let category: ErrorLogEntry['category'] = 'unknown';
  if (isNetwork) category = 'network';
  else if (isTimeout) category = 'timeout';
  else if (isJSON) category = 'parsing';
  else if (isValidation) category = 'validation';

  const entry: ErrorLogEntry = {
    id,
    timestamp: Date.now(),
    severity,
    category,
    message,
    errorMessage: errorMsg,
    errorStack,
    source: context.source,
    operation: context.operation,
    details: context.details,
    narrativeId: activeNarrativeId ?? undefined,
    analysisId: activeAnalysisId ?? undefined,
    discoveryId: activeDiscoveryId ?? undefined,
  };

  // Log to console as well as modal
  const consoleMsg = `[${severity.toUpperCase()}] [${context.source}${context.operation ? `/${context.operation}` : ''}] ${message}\n${errorMsg}`;
  if (severity === 'error') {
    console.error(consoleMsg, context.details);
  } else {
    console.warn(consoleMsg, context.details);
  }

  logListener?.(entry);
  return id;
}

/**
 * Log lifecycle milestones and info events for full transparency.
 * Use this to track major operations, state transitions, and system events.
 * Details are logged as JSON for easy copy/paste debugging.
 */
export function logInfo(
  message: string,
  context: ErrorContext
): string {
  const id = `info-${Date.now()}-${counter++}`;

  const entry: ErrorLogEntry = {
    id,
    timestamp: Date.now(),
    severity: 'info',
    category: 'lifecycle',
    message,
    source: context.source,
    operation: context.operation,
    details: context.details,
    narrativeId: activeNarrativeId ?? undefined,
    analysisId: activeAnalysisId ?? undefined,
    discoveryId: activeDiscoveryId ?? undefined,
  };

  // Log to console with JSON format for easy copy/paste
  const consoleMsg = `[INFO] [${context.source}${context.operation ? `/${context.operation}` : ''}] ${message}`;
  console.info(consoleMsg, context.details ? JSON.stringify(context.details, null, 2) : '');

  logListener?.(entry);
  return id;
}

export function logWarning(
  message: string,
  error: Error | string | unknown,
  context: ErrorContext
): string {
  return logError(message, error, context, 'warning');
}
