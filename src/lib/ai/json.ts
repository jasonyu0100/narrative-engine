/** Clean common LLM JSON quirks: code fences, trailing commas, single-quoted keys */
export function cleanJson(raw: string): string {
  let s = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  // Extract just the JSON part if LLM added extra text after
  // Find the first { or [, then find its matching closing bracket
  const firstBrace = s.indexOf('{');
  const firstBracket = s.indexOf('[');
  const start = firstBrace >= 0 && (firstBracket < 0 || firstBrace < firstBracket) ? firstBrace : firstBracket;

  if (start >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < s.length; i++) {
      const ch = s[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === '\\' && inString) {
        escaped = true;
        continue;
      }

      if (ch === '"' && !escaped) {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (ch === '{' || ch === '[') depth++;
        if (ch === '}' || ch === ']') {
          depth--;
          if (depth === 0) {
            // Found the matching closing bracket
            s = s.substring(start, i + 1);
            break;
          }
        }
      }
    }
  }

  // Remove trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, '$1');
  // Insert missing commas between adjacent elements (common LLM failure in large JSON)
  // } { → }, {  and  ] [ → ], [
  s = s.replace(/\}(\s*)\{/g, '},$1{');
  s = s.replace(/\](\s*)\[/g, '],$1[');
  // Fix unescaped control characters inside JSON string values.
  // Walk character-by-character: when inside a quoted string, escape raw
  // newlines/tabs/backspaces that the LLM forgot to escape.
  const out: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escaped) {
      out.push(ch);
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      out.push(ch);
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out.push(ch);
      continue;
    }
    if (inString) {
      if (ch === '\n') { out.push('\\n'); continue; }
      if (ch === '\r') { out.push('\\r'); continue; }
      if (ch === '\t') { out.push('\\t'); continue; }
    }
    out.push(ch);
  }
  return out.join('');
}

/**
 * Attempt to fix unescaped double-quotes inside JSON string values.
 * When the LLM writes `"she said "hello" to him"`, the inner quotes break
 * the parse. This walks the string and escapes quotes that appear mid-value.
 */
export function repairUnescapedQuotes(s: string): string {
  const out: string[] = [];
  let i = 0;
  const len = s.length;

  while (i < len) {
    // Skip whitespace / structural chars outside strings
    if (s[i] !== '"') { out.push(s[i++]); continue; }

    // Opening quote of a string value
    out.push(s[i++]); // the opening "
    // Scan for the *real* closing quote.
    // The real closing quote is followed by a structural char: , } ] :
    // (possibly with whitespace in between).
    while (i < len) {
      if (s[i] === '\\') {
        // Already-escaped char — pass through
        out.push(s[i], s[i + 1] ?? '');
        i += 2;
        continue;
      }
      if (s[i] === '"') {
        // Is this the real closing quote?
        // Look ahead past whitespace for a structural char or EOF
        let peek = i + 1;
        while (peek < len && (s[peek] === ' ' || s[peek] === '\n' || s[peek] === '\r' || s[peek] === '\t')) peek++;
        if (peek >= len || s[peek] === ',' || s[peek] === '}' || s[peek] === ']' || s[peek] === ':') {
          // Real closing quote
          out.push('"');
          i++;
          break;
        } else {
          // Unescaped inner quote — escape it
          out.push('\\"');
          i++;
          continue;
        }
      }
      out.push(s[i++]);
    }
  }
  return out.join('');
}

/** Parse JSON with detailed error context for debugging truncated LLM responses */
export function parseJson(raw: string, context: string): unknown {
  if (!raw || !raw.trim()) {
    throw new Error(`[${context}] Empty response from LLM — received no content`);
  }
  const cleaned = cleanJson(raw);
  try {
    return JSON.parse(cleaned);
  } catch (firstErr) {
    // Attempt repair: fix unescaped quotes inside string values
    try {
      const repaired = repairUnescapedQuotes(cleaned);
      return JSON.parse(repaired);
    } catch {
      // Repair didn't help — throw with original error context
    }
    const preview = cleaned.length > 300
      ? `${cleaned.slice(0, 150)}…[${cleaned.length} chars total]…${cleaned.slice(-150)}`
      : cleaned;
    const truncated = cleaned.endsWith('}') || cleaned.endsWith(']') ? '' : ' (likely truncated — response hit max_tokens limit)';
    throw new Error(
      `[${context}] Failed to parse JSON${truncated}\n` +
      `Original error: ${firstErr instanceof Error ? firstErr.message : String(firstErr)}\n` +
      `Response preview: ${preview}`
    );
  }
}
