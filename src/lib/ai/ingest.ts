import { callGenerate, SYSTEM_PROMPT } from './api';
import { GENERATE_MODEL } from '@/lib/constants';
import { parseJson } from './json';
import type { NarrativeState, ProseProfile } from '@/types/narrative';
import { buildIngestProseProfilePrompt, buildDeriveProseProfilePrompt } from '@/lib/prompts';
import { logError, logInfo } from '@/lib/system-logger';

/**
 * Parse pasted text (prose sample, style guide, author analysis) into a ProseProfile.
 * Extracts voice, stance, devices, and rules from the text.
 * Prompt body lives in src/lib/prompts/ingest — see buildIngestProseProfilePrompt.
 */
export async function ingestProseProfile(text: string, existing?: Partial<ProseProfile>): Promise<ProseProfile> {
  const existingBlock = existing ? JSON.stringify(existing, null, 2) : undefined;
  const prompt = buildIngestProseProfilePrompt(text, existingBlock);

  logInfo('Ingesting prose profile from sample', {
    source: 'ingest',
    operation: 'ingest-prose-profile',
    details: { sampleLength: text.length, hasExisting: !!existing },
  });

  let raw: string;
  try {
    raw = await callGenerate(prompt, SYSTEM_PROMPT, undefined, 'ingestProseProfile', GENERATE_MODEL);
  } catch (err) {
    logError('ingestProseProfile call failed', err, {
      source: 'ingest',
      operation: 'ingest-prose-profile',
    });
    throw err;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = parseJson(raw, 'ingestProseProfile') as any;

  return {
    register:       typeof parsed.register === 'string'       ? parsed.register       : 'conversational',
    stance:         typeof parsed.stance === 'string'         ? parsed.stance         : 'close_third',
    tense:          typeof parsed.tense === 'string'          ? parsed.tense          : undefined,
    sentenceRhythm: typeof parsed.sentenceRhythm === 'string' ? parsed.sentenceRhythm : undefined,
    interiority:    typeof parsed.interiority === 'string'    ? parsed.interiority    : undefined,
    dialogueWeight: typeof parsed.dialogueWeight === 'string' ? parsed.dialogueWeight : undefined,
    devices:        Array.isArray(parsed.devices) ? parsed.devices.filter((d: unknown) => typeof d === 'string') : [],
    rules:          Array.isArray(parsed.rules)   ? parsed.rules.filter((r: unknown) => typeof r === 'string')   : [],
    antiPatterns:   Array.isArray(parsed.antiPatterns) ? parsed.antiPatterns.filter((a: unknown) => typeof a === 'string') : [],
  };
}

/**
 * Derive a prose profile from the story's narrative context — characters, threads,
 * world rules, tone, and sample prose. No pasted text needed.
 */
export async function deriveProseProfile(narrative: NarrativeState): Promise<ProseProfile> {
  // Build a compact context from the narrative
  const lines: string[] = [];

  lines.push(`TITLE: ${narrative.title}`);
  if (narrative.description) lines.push(`DESCRIPTION: ${narrative.description}`);

  // Characters — names, roles, brief descriptions
  const chars = Object.values(narrative.characters);
  if (chars.length > 0) {
    lines.push(`\nCHARACTERS (${chars.length}):`);
    for (const c of chars.slice(0, 15)) {
      lines.push(`  - ${c.name} (${c.role})`);
    }
  }

  // Threads — narrative tensions
  const threads = Object.values(narrative.threads);
  if (threads.length > 0) {
    lines.push(`\nTHREADS (${threads.length}):`);
    for (const t of threads.slice(0, 10)) {
      lines.push(`  - ${t.id} [${t.status}]: ${t.description.slice(0, 100)}`);
    }
  }

  // Sample scene summaries for tone
  const scenes = Object.values(narrative.scenes);
  if (scenes.length > 0) {
    lines.push(`\nSCENE SUMMARIES (sample):`);
    for (const s of scenes.slice(0, 8)) {
      const pov = narrative.characters[s.povId]?.name ?? s.povId;
      lines.push(`  - [${pov}] ${s.summary.slice(0, 150)}`);
    }
  }

  // Sample prose excerpts (first few scenes that have prose)
  const withProse = scenes.filter((s) => s.proseVersions && s.proseVersions.length > 0);
  if (withProse.length > 0) {
    lines.push(`\nPROSE EXCERPTS:`);
    for (const s of withProse.slice(0, 3)) {
      const latestProse = s.proseVersions![s.proseVersions!.length - 1].prose;
      const excerpt = latestProse.slice(0, 2000);
      lines.push(`---\n${excerpt}\n---`);
    }
  }

  const context = lines.join('\n');
  const prompt = buildDeriveProseProfilePrompt(context);

  logInfo('Deriving prose profile from narrative', {
    source: 'ingest',
    operation: 'derive-prose-profile',
    details: {
      characters: chars.length,
      threads: threads.length,
      scenes: scenes.length,
      proseExcerpts: withProse.length,
    },
  });

  let raw: string;
  try {
    raw = await callGenerate(prompt, SYSTEM_PROMPT, undefined, 'deriveProseProfile', GENERATE_MODEL);
  } catch (err) {
    logError('deriveProseProfile call failed', err, {
      source: 'ingest',
      operation: 'derive-prose-profile',
    });
    throw err;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = parseJson(raw, 'deriveProseProfile') as any;

  return {
    register:       typeof parsed.register === 'string'       ? parsed.register       : 'conversational',
    stance:         typeof parsed.stance === 'string'         ? parsed.stance         : 'close_third',
    tense:          typeof parsed.tense === 'string'          ? parsed.tense          : undefined,
    sentenceRhythm: typeof parsed.sentenceRhythm === 'string' ? parsed.sentenceRhythm : undefined,
    interiority:    typeof parsed.interiority === 'string'    ? parsed.interiority    : undefined,
    dialogueWeight: typeof parsed.dialogueWeight === 'string' ? parsed.dialogueWeight : undefined,
    devices:        Array.isArray(parsed.devices) ? parsed.devices.filter((d: unknown) => typeof d === 'string') : [],
    rules:          Array.isArray(parsed.rules)   ? parsed.rules.filter((r: unknown) => typeof r === 'string')   : [],
    antiPatterns:   Array.isArray(parsed.antiPatterns) ? parsed.antiPatterns.filter((a: unknown) => typeof a === 'string') : [],
  };
}
