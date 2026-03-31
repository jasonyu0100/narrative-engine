/**
 * Builds headers that include user-provided API keys from localStorage
 * when NEXT_PUBLIC_USER_API_KEYS is enabled.
 * Server-side routes fall back to env vars when headers are absent.
 */
export function apiHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extra,
  };

  if (typeof window === 'undefined') return headers;
  if (process.env.NEXT_PUBLIC_USER_API_KEYS !== 'true') return headers;

  const orKey = localStorage.getItem('ne_openrouter_key');
  const repKey = localStorage.getItem('ne_replicate_key');
  const oaiKey = localStorage.getItem('ne_openai_key');

  if (orKey) headers['x-openrouter-key'] = orKey;
  if (repKey) headers['x-replicate-key'] = repKey;
  if (oaiKey) headers['x-openai-key'] = oaiKey;

  return headers;
}
