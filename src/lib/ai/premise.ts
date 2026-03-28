import { callGenerate, SYSTEM_PROMPT } from './api';
import { GENERATE_MODEL } from '@/lib/constants';
import { parseJson } from './json';

// ── Types ────────────────────────────────────────────────────────────────────

export type PremiseEntityType = 'character' | 'location' | 'thread';

export type PremiseEntity = {
  id: string;
  type: PremiseEntityType;
  name: string;
  description: string;
  role?: 'anchor' | 'recurring' | 'transient'; // characters only
  participantNames?: string[]; // threads only
};

export type PremiseEdge = {
  from: string;
  to: string;
  label: string;
};

export type PremiseChoice = {
  id: string;
  label: string;
  description: string;
};

export type PremiseQuestion = {
  text: string;
  context: string;
  choices: PremiseChoice[];
};

export type PremiseDecision = {
  question: string;
  answer: string;
};

export type PremiseSystemSketch = {
  name: string;
  description: string;
  principles: string[];
  constraints: string[];
  interactions: string[];
};

export type PremiseQuestionResult = {
  question: PremiseQuestion;
  newEntities: PremiseEntity[];
  newEdges: PremiseEdge[];
  newRules: string[];
  newSystems: PremiseSystemSketch[];
  systemUpdates: { name: string; addPrinciples?: string[]; addConstraints?: string[]; addInteractions?: string[] }[];
  title: string;
  worldSummary: string;
};

// ── System prompt ────────────────────────────────────────────────────────────

const PREMISE_SYSTEM = `You are a world architect helping a writer craft a narrative premise through Socratic questioning. Your goal is to draw out a rich, specific, conflict-laden world by asking one focused question at a time.

Each question should:
- Offer 3-4 choices that take the world in meaningfully different directions
- Go deeper as the conversation progresses — start broad (genre, tone, scale) then drill into specifics (characters, conflicts, systems, locations, threads)
- Never repeat a topic already established
- Each choice should be vivid and specific, not generic

As you process each answer, extract:
- Concrete entities (characters, locations, narrative threads)
- World systems — structured mechanics that define how the world works (power systems, economies, social structures, progression paths, combat logic, cosmic laws, etc.)

Build the world incrementally. World systems should emerge naturally from decisions — when the writer establishes how magic works, how society is organized, how power is gained or lost, capture these as structured systems with principles, constraints, and cross-system interactions.`;

// ── Generate next question ───────────────────────────────────────────────────

export async function generatePremiseQuestion(
  seed: string,
  decisions: PremiseDecision[],
  entities: PremiseEntity[],
  edges: PremiseEdge[],
  rules: string[],
  currentTitle: string,
  systems: PremiseSystemSketch[] = [],
  discoveryPhase: 'systems' | 'rules' | 'cast' | 'threads' = 'systems',
): Promise<PremiseQuestionResult> {
  const round = decisions.length + 1;

  // Build decision history
  const historyBlock = decisions.length > 0
    ? `DECISIONS SO FAR:\n${decisions.map((d, i) => `${i + 1}. Q: ${d.question}\n   A: ${d.answer}`).join('\n')}`
    : 'No decisions yet — this is the opening question.';

  // Build entity inventory
  const chars = entities.filter(e => e.type === 'character');
  const locs = entities.filter(e => e.type === 'location');
  const threads = entities.filter(e => e.type === 'thread');

  const systemsBlock = systems.length > 0
    ? `World Systems (${systems.length}):\n${systems.map(s => {
      const parts = [`  - ${s.name}: ${s.description}`];
      if (s.principles.length) parts.push(`    Principles: ${s.principles.join('; ')}`);
      if (s.constraints.length) parts.push(`    Constraints: ${s.constraints.join('; ')}`);
      if (s.interactions.length) parts.push(`    Interactions: ${s.interactions.join('; ')}`);
      return parts.join('\n');
    }).join('\n')}`
    : 'World Systems: none';

  const inventoryBlock = entities.length > 0 || systems.length > 0
    ? `CURRENT WORLD INVENTORY:
Characters (${chars.length}): ${chars.map(c => `${c.name} — ${c.description}`).join('; ') || 'none'}
Locations (${locs.length}): ${locs.map(l => `${l.name} — ${l.description}`).join('; ') || 'none'}
Threads (${threads.length}): ${threads.map(t => `${t.name} — ${t.description}`).join('; ') || 'none'}
Rules (${rules.length}): ${rules.join('; ') || 'none'}
${systemsBlock}
Edges: ${edges.map(e => `${e.from} → ${e.to}: ${e.label}`).join('; ') || 'none'}`
    : 'No entities established yet.';

  // Phase-specific guidance
  const PHASE_GUIDANCE: Record<string, string> = {
    systems: `PHASE: SYSTEMS — Focus exclusively on world mechanics. Ask about power systems, economies, social structures, progression paths, combat logic, cosmic laws, technological frameworks, or any structured mechanic that defines how this world works. Extract structured systems with principles, constraints, and cross-system interactions. You may introduce locations if they are integral to a system (e.g. a magical academy, a trade hub), but do NOT introduce characters or narrative threads yet.`,
    rules: `PHASE: RULES — Focus exclusively on world rules and narrative tone. Ask about commandments that govern the world's style: what is always true, what is forbidden, the moral framework, genre conventions, narrative voice, thematic boundaries. Examples: "Magic always has a cost", "No character is purely good", "Technology cannot solve social problems". Extract these as rules. Do NOT introduce new characters or threads.`,
    cast: `PHASE: CAST & LOCATIONS — Focus exclusively on characters and places. Ask about key figures, their roles, relationships, motivations, flaws, and important locations. Reference established systems and rules to ground characters in the world. Extract character and location entities with relationship edges.`,
    threads: `PHASE: THREADS — Focus exclusively on narrative threads — the tensions, conflicts, secrets, and open questions that will drive the story. Each thread should connect to established characters, locations, and systems. Ask about what's at stake, who wants what, and where interests collide. Extract thread entities with participant names.`,
  };
  const phaseGuidance = PHASE_GUIDANCE[discoveryPhase] ?? PHASE_GUIDANCE.systems;

  // What's thin?
  const gaps: string[] = [];
  if (chars.length < 2 && round > 2) gaps.push('Few characters — consider asking about key figures');
  if (locs.length < 2 && round > 3) gaps.push('Few locations — consider asking about geography');
  if (threads.length < 1 && round > 3) gaps.push('No narrative threads — consider asking about tensions or open questions');
  if (rules.length < 1 && round > 4) gaps.push('No world rules — consider asking about constraints or laws');
  if (systems.length < 1 && round > 3) gaps.push('No world systems — consider asking about how the world\'s mechanics work');

  const prompt = `${seed ? `SEED CONCEPT: ${seed}\n\n` : ''}${historyBlock}

${inventoryBlock}

ROUND: ${round}
${phaseGuidance}
${gaps.length > 0 ? `\nGAPS TO ADDRESS:\n${gaps.map(g => `- ${g}`).join('\n')}` : ''}
${currentTitle ? `WORKING TITLE: ${currentTitle}` : ''}

Ask ONE question with 3-4 choices. Extract NEW entities, edges, rules, and world systems crystallized by the most recent answer. Update the title and world summary.
${discoveryPhase === 'cast' ? 'IMPORTANT: Every answer in the Cast phase MUST produce at least one new character or location entity. If the user described a character, extract them. If they described a place, extract it. Never return an empty newEntities array in this phase.' : ''}
${discoveryPhase === 'threads' ? 'IMPORTANT: Every answer in the Threads phase MUST produce at least one new thread entity connecting to existing characters. Never return an empty newEntities array in this phase.' : ''}
${discoveryPhase === 'systems' ? 'IMPORTANT: Every answer in the Systems phase MUST produce or update at least one system. Never return both empty newSystems and empty systemUpdates in this phase.' : ''}
${discoveryPhase === 'rules' ? 'IMPORTANT: Every answer in the Rules phase MUST produce at least one new rule. Never return an empty newRules array in this phase.' : ''}

Return JSON:
{
  "question": {
    "text": "the question",
    "context": "1-sentence why this matters for the world",
    "choices": [
      {"id": "a", "label": "short label (3-5 words)", "description": "1-sentence elaboration"},
      {"id": "b", "label": "...", "description": "..."},
      {"id": "c", "label": "...", "description": "..."}
    ]
  },
  "newEntities": [
    {"id": "char-1", "type": "character", "name": "Name", "description": "brief", "role": "anchor|recurring|transient"},
    {"id": "loc-1", "type": "location", "name": "Name", "description": "brief"},
    {"id": "thread-1", "type": "thread", "name": "Thread name", "description": "the tension", "participantNames": ["Name1", "Name2"]}
  ],
  "newEdges": [
    {"from": "char-1", "to": "loc-1", "label": "lives in"}
  ],
  "newRules": ["rule text"],
  "newSystems": [
    {"name": "System Name", "description": "What this system is", "principles": ["How it works"], "constraints": ["Hard limits"], "interactions": ["How it connects to other systems"]}
  ],
  "systemUpdates": [
    {"name": "Existing System Name", "addPrinciples": ["new principle"], "addConstraints": ["new constraint"], "addInteractions": ["new interaction"]}
  ],
  "title": "Suggested Title",
  "worldSummary": "2-3 sentence world description incorporating all decisions so far"
}

Rules for entities:
- Only return NEW entities crystallized by the LATEST answer. Don't repeat existing ones.
- Entity IDs: use char-N, loc-N, thread-N format, continuing from existing counts.
- Edges can reference any entity ID (existing or new).
- newRules, newEntities, newEdges, newSystems, systemUpdates can be empty arrays if the latest answer didn't crystallize anything concrete yet.
- For round 1 (no decisions yet), return empty arrays for everything.

Rules for world systems:
- A world system is any distinct mechanic, institution, force, or structure that shapes how the world operates.
- Use newSystems for entirely new systems the answer established.
- Use systemUpdates to add principles/constraints/interactions to existing systems by matching their name.
- Systems should emerge naturally — when the writer establishes how power works, how society is organized, what resources matter, capture those as systems.
- Each system needs: name, description, at least 1 principle. Constraints and interactions can be empty initially.`;

  const raw = await callGenerate(prompt, PREMISE_SYSTEM, undefined, 'premiseQuestion', GENERATE_MODEL);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = parseJson(raw, 'premiseQuestion') as any;

  return {
    question: parsed.question,
    newEntities: parsed.newEntities ?? [],
    newEdges: parsed.newEdges ?? [],
    newRules: parsed.newRules ?? [],
    newSystems: Array.isArray(parsed.newSystems) ? parsed.newSystems.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (s: any) => s && typeof s.name === 'string'
    ) : [],
    systemUpdates: Array.isArray(parsed.systemUpdates) ? parsed.systemUpdates.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (u: any) => u && typeof u.name === 'string'
    ) : [],
    title: parsed.title ?? currentTitle,
    worldSummary: parsed.worldSummary ?? '',
  };
}

// ── Build premise text ───────────────────────────────────────────────────────

export function buildPremiseText(
  entities: PremiseEntity[],
  rules: string[],
  worldSummary: string,
  systems: PremiseSystemSketch[] = [],
): { premise: string; characters: { name: string; role: string; description: string }[]; locations: { name: string; description: string }[]; threads: { description: string; participantNames: string[] }[]; rules: string[]; worldSystems: PremiseSystemSketch[] } {
  const chars = entities.filter(e => e.type === 'character');
  const locs = entities.filter(e => e.type === 'location');
  const threads = entities.filter(e => e.type === 'thread');

  const parts: string[] = [worldSummary];

  if (chars.length > 0) {
    parts.push(`\nKey characters:\n${chars.map(c => `  - ${c.name} (${c.role ?? 'recurring'}): ${c.description}`).join('\n')}`);
  }
  if (locs.length > 0) {
    parts.push(`\nKey locations:\n${locs.map(l => `  - ${l.name}: ${l.description}`).join('\n')}`);
  }
  if (threads.length > 0) {
    parts.push(`\nNarrative threads:\n${threads.map(t => `  - ${t.name}: ${t.description}${t.participantNames?.length ? ` (involves: ${t.participantNames.join(', ')})` : ''}`).join('\n')}`);
  }
  if (rules.length > 0) {
    parts.push(`\nWorld rules (absolute constraints the narrative must obey):\n${rules.map((r, i) => `  ${i + 1}. ${r}`).join('\n')}`);
  }
  if (systems.length > 0) {
    parts.push(`\nWorld systems:\n${systems.map(s => {
      const lines = [`  - ${s.name}: ${s.description}`];
      if (s.principles.length) lines.push(`    Principles: ${s.principles.join('; ')}`);
      if (s.constraints.length) lines.push(`    Constraints: ${s.constraints.join('; ')}`);
      if (s.interactions.length) lines.push(`    Interactions: ${s.interactions.join('; ')}`);
      return lines.join('\n');
    }).join('\n')}`);
  }

  return {
    premise: parts.join('\n'),
    characters: chars.map(c => ({ name: c.name, role: c.role ?? 'recurring', description: c.description })),
    locations: locs.map(l => ({ name: l.name, description: l.description })),
    threads: threads.map(t => ({ description: t.description, participantNames: t.participantNames ?? [] })),
    rules,
    worldSystems: systems,
  };
}
