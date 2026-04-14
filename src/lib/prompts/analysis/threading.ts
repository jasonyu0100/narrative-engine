/**
 * Thread Dependency Analysis Prompt
 *
 * Given a canonical (post-merge) list of threads, identifies which threads
 * causally depend on which others.
 */

export const THREADING_SYSTEM =
  'You are a narrative structure analyst. Identify causal dependencies between story threads. Return only valid JSON.';

export function buildThreadingPrompt(canonicalThreads: string[]): string {
  return `You are analyzing narrative threads to identify causal dependencies.

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
}
