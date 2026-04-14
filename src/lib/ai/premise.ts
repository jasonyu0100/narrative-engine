/**
 * Premise suggestion for the creation wizard.
 * Generates random story ideas to help users get started.
 * The prompt body lives in src/lib/prompts/premise/ — see PREMISE_SUGGEST_PROMPT.
 */

import { callGenerate, SYSTEM_PROMPT } from './api';
import { parseJson } from './json';
import { PREMISE_SUGGEST_PROMPT } from '@/lib/prompts';
import { logError, logInfo } from '@/lib/system-logger';

/**
 * Suggest a random narrative premise with title.
 * Used by the creation wizard to inspire story ideas.
 */
export async function suggestPremise(): Promise<{ title?: string; premise?: string }> {
  logInfo('Suggesting premise', { source: 'ingest', operation: 'suggest-premise' });

  let raw: string;
  try {
    raw = await callGenerate(PREMISE_SUGGEST_PROMPT, SYSTEM_PROMPT, 500, 'suggestPremise');
  } catch (err) {
    logError('suggestPremise call failed', err, {
      source: 'ingest',
      operation: 'suggest-premise',
    });
    throw err;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = parseJson(raw, 'suggestPremise') as any;

  return {
    title: typeof parsed.title === 'string' ? parsed.title : undefined,
    premise: typeof parsed.premise === 'string' ? parsed.premise : undefined,
  };
}
