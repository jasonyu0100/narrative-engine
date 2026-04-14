/**
 * Core-language guard.
 *
 * Enforces the canonical vocabulary documented in
 * src/lib/prompts/CORE_LANGUAGE.md. These tests check that:
 *   1. Canonical terms (scene, arc, beat, delta, thread, fate, world, system,
 *      narrative, proposition, entity, POV) appear in the centralised prompt
 *      repository at least once — so removing them is a deliberate decision,
 *      not an accident.
 *   2. Fiction-coded defaults that should be avoided as the unqualified framing
 *      (e.g. "novel", "novelistic", "chapter") do not drift into new prompts.
 *
 * If a test fails, either:
 *   (a) update the prompt to use the canonical term / register-neutral phrasing,
 *   (b) or — if the change is intentional — update CORE_LANGUAGE.md and this
 *       test in the same commit.
 */

import { describe, expect, it } from 'vitest';
import * as prompts from '@/lib/prompts';

const CANONICAL_TERMS = [
  'scene',
  'arc',
  'beat',
  'delta',
  'thread',
  'fate',
  'world',
  'system',
  'narrative',
  'proposition',
  'entity',
  'POV',
] as const;

/**
 * Patterns that should not appear as the *default* framing in centralised
 * prompts. Each entry is a case-insensitive word-boundary pattern plus a
 * list of prompt names that are allowed to mention the term (e.g. a screenplay
 * format instruction is genuinely about screenplays — "screenplay" is fine
 * there; a prompt that explicitly contrasts fiction vs non-fiction may need
 * to say "novel" to make the contrast concrete).
 */
type Forbidden = {
  pattern: RegExp;
  reason: string;
  /** Prompt keys in which this term is allowed to appear. */
  allowIn?: string[];
};

const FORBIDDEN: Forbidden[] = [
  {
    pattern: /\bnovelistic\b/i,
    reason: 'Avoid "novelistic" as a universal register — qualify or use a register-neutral term.',
    // The prose format rules intentionally reference "novelistic" to scope the
    // fiction-specific bullet; that usage is allowed.
    allowIn: ['FORMAT_INSTRUCTIONS'],
  },
  {
    pattern: /\bfor a novel\b/i,
    reason: '"for a novel" hard-codes fiction. Use "of a longer narrative" or similar.',
  },
  {
    pattern: /\bchapter headers?\b/i,
    reason: '"chapter" biases toward fiction pagination. Prefer "part/chapter" or "arc" with qualification.',
    // Format rules mention "part/chapter headers" deliberately when listing
    // what NOT to emit; that qualified usage is allowed.
    allowIn: ['FORMAT_INSTRUCTIONS'],
  },
];

/**
 * Everything on the default export of '@/lib/prompts' that is a string.
 * Functions with no argument are called to get their output; others are
 * skipped (they need runtime context and are covered by ai-prompts.test.ts).
 */
function collectStringPrompts(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(prompts)) {
    if (typeof val === 'string') {
      out[key] = val;
    } else if (typeof val === 'function' && val.length === 0) {
      try {
        const result = (val as () => unknown)();
        if (typeof result === 'string') out[key] = result;
      } catch {
        // Skip functions that need context.
      }
    } else if (val && typeof val === 'object') {
      // Flatten one level for records like FORMAT_INSTRUCTIONS.
      for (const [subKey, subVal] of Object.entries(val as Record<string, unknown>)) {
        if (typeof subVal === 'string') {
          out[`${key}.${subKey}`] = subVal;
        } else if (subVal && typeof subVal === 'object') {
          for (const [leafKey, leafVal] of Object.entries(subVal as Record<string, unknown>)) {
            if (typeof leafVal === 'string') {
              out[`${key}.${subKey}.${leafKey}`] = leafVal;
            }
          }
        }
      }
    }
  }
  return out;
}

describe('core language — canonical terms', () => {
  const corpus = collectStringPrompts();
  const joined = Object.values(corpus).join('\n').toLowerCase();

  for (const term of CANONICAL_TERMS) {
    it(`canonical term "${term}" appears somewhere in the centralised prompts`, () => {
      expect(joined).toContain(term.toLowerCase());
    });
  }
});

describe('core language — forbidden defaults', () => {
  const corpus = collectStringPrompts();

  for (const rule of FORBIDDEN) {
    it(`"${rule.pattern.source}" does not leak into centralised prompts (${rule.reason})`, () => {
      const offenders: string[] = [];
      for (const [key, text] of Object.entries(corpus)) {
        if (rule.pattern.test(text)) {
          const rootKey = key.split('.')[0];
          if (rule.allowIn?.includes(rootKey)) continue;
          offenders.push(key);
        }
      }
      expect(offenders, `Offending prompts: ${offenders.join(', ')}`).toEqual([]);
    });
  }
});
