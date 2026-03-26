import { callGenerate, SYSTEM_PROMPT } from './api';
import { GENERATE_MODEL } from '@/lib/constants';
import { parseJson } from './json';
import type { WorldSystem } from '@/types/narrative';

/**
 * Parse pasted text (from another AI, a wiki, notes, etc.) into world rules.
 * Rules are high-level constraints that define the series — things that are always true.
 */
export async function ingestRules(text: string, existingRules: string[] = []): Promise<string[]> {
  const prompt = `Analyze the following text and extract world rules — high-level absolute constraints that define this world/series. Rules are things that are ALWAYS true in this universe. They define the boundaries of what is possible.

Examples of good rules:
- "Magic requires equivalent exchange — nothing is created from nothing"
- "The dead cannot be resurrected by any means"
- "Information travels no faster than a horse can ride"
- "All cultivators must survive tribulations to advance"

Rules are NOT:
- Specific plot points or character details
- Mechanical system descriptions (those belong in world systems)
- Obvious real-world facts

${existingRules.length > 0 ? `EXISTING RULES (don't duplicate these):\n${existingRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n` : ''}
TEXT TO ANALYZE:
${text}

Return JSON:
{
  "rules": ["rule 1", "rule 2", ...]
}

Extract 3-10 rules depending on complexity. For simple/realistic worlds, extract fewer. For complex fantasy/sci-fi worlds with many unique constraints, extract more. Only extract rules that are clearly stated or strongly implied — don't invent.`;

  const raw = await callGenerate(prompt, SYSTEM_PROMPT, undefined, 'ingestRules', GENERATE_MODEL);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = parseJson(raw, 'ingestRules') as any;
  return Array.isArray(parsed.rules) ? parsed.rules.filter((r: unknown) => typeof r === 'string') : [];
}

/**
 * Parse pasted text into structured world systems.
 * Systems are mechanical descriptions of how the world operates — power systems, economies, social structures, etc.
 */
export async function ingestSystems(text: string, existingSystems: WorldSystem[] = []): Promise<WorldSystem[]> {
  const existingBlock = existingSystems.length > 0
    ? `EXISTING SYSTEMS (don't duplicate — but you may add to them via new principles/constraints/interactions):\n${existingSystems.map(s => `- ${s.name}: ${s.description}`).join('\n')}\n`
    : '';

  const prompt = `Analyze the following text and extract world systems — structured mechanics that define how this world uniquely operates. A system is any distinct mechanic, institution, force, or structure that shapes the world.

For each system, extract:
- name: Clear label
- description: One-line summary
- principles: How it works (the core mechanics)
- constraints: Hard limits, costs, failure modes, scarcity rules
- interactions: How it connects to or affects other systems

Examples of systems:
- Power/magic systems (how abilities work, what fuels them)
- Progression systems (how characters advance, what it costs)
- Economic systems (resources, trade, scarcity)
- Social/political structures (factions, hierarchies, institutions)
- Combat/conflict mechanics (how battles are decided)
- Natural/cosmic laws (balancing forces, fate mechanics)

Systems are MECHANICAL — they describe HOW things work, not just that they exist.
For simple/realistic worlds, you may find few or no systems. For complex fantasy/sci-fi, there may be many.
Only extract systems clearly described or strongly implied — don't invent.

${existingBlock}
TEXT TO ANALYZE:
${text}

Return JSON:
{
  "systems": [
    {
      "name": "System Name",
      "description": "One-line summary",
      "principles": ["How it works"],
      "constraints": ["Hard limits"],
      "interactions": ["Cross-system connections"]
    }
  ]
}`;

  const raw = await callGenerate(prompt, SYSTEM_PROMPT, undefined, 'ingestSystems', GENERATE_MODEL);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = parseJson(raw, 'ingestSystems') as any;
  if (!Array.isArray(parsed.systems)) return [];

  return parsed.systems
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((s: any) => s && typeof s.name === 'string')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((s: any) => ({
      id: `WS-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: s.name,
      description: typeof s.description === 'string' ? s.description : '',
      principles: Array.isArray(s.principles) ? s.principles.filter((p: unknown) => typeof p === 'string') : [],
      constraints: Array.isArray(s.constraints) ? s.constraints.filter((c: unknown) => typeof c === 'string') : [],
      interactions: Array.isArray(s.interactions) ? s.interactions.filter((x: unknown) => typeof x === 'string') : [],
    }));
}
