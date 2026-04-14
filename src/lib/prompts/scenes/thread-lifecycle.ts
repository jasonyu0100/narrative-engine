/**
 * Thread Lifecycle Prompts and Helper Functions
 *
 * CONCEPTUAL MODEL: Threads are QUESTIONS that have yet to be answered.
 * They actively shape fate by pulling the story toward resolution.
 * Thread logs track how these questions are being answered over time.
 */

import { THREAD_TERMINAL_STATUSES } from '@/types/narrative';
import type { NarrativeState } from '@/types/narrative';
import { THREAD_LIFECYCLE_DOC } from '@/lib/ai/context';
import { ENTITY_LOG_CONTEXT_LIMIT } from '@/lib/constants';

/**
 * Generate thread lifecycle documentation prompt.
 */
export function promptThreadLifecycle(): string {
  return `
THREADS ARE COMPELLING QUESTIONS — each thread is an unanswered question that actively shapes fate.
A compelling question has STAKES (what's at risk), UNCERTAINTY (outcome not obvious), and INVESTMENT (we care about the answer).
The register of the question adapts to the work:
  - Narrative (fiction, memoir): dramatic questions about consequence, identity, choice.
  - Argument (paper, essay, criticism): claims whose truth, scope, or priority is in contention.
  - Inquiry (investigation, reportage, exploration): questions about what happened, how it works, what follows.
  Weak (any register): "Will [Name] go to the store?" — too plain to carry an arc unless the form deliberately rewards such flatness (picaresque, satirical, ironic open-inquiry).
  Strong (narrative): "Can Ayesha clear her grandfather's name before the tribunal ends?" (stakes, uncertainty, investment)
  Strong (narrative, lyric register): "What does the river remember of the flood, and does the narrator want to know?"
  Strong (argument): "Does the proposed mechanism explain the anomalies the prior model cannot?" (falsifiable, non-obvious)
  Strong (argument, criticism): "Can poststructuralist close reading account for silence as resistance in this corpus?" (disputed, high investment)
  Strong (inquiry): "What role did diaspora networks play in the movement before digital coordination?" (open, evidence-driven)
Frame threads as questions. Thread logs track incremental answers over time.

THREAD LIFECYCLE: latent → seeded → active → escalating → critical → resolved/subverted
${THREAD_LIFECYCLE_DOC}
Terminal: ${THREAD_TERMINAL_STATUSES.map((s) => `"${s}"`).join(', ')}.

STAGES (single lifecycle, reframe per register):
  latent (whisper / hint / gap)        → the question is implicit, unposed
  seeded (posed / claim stated / question raised) → the reader/auditor now holds the question
  active (pursued / evidenced / developed) → the work is actively working the question
  escalating (COMMITTED / dominant / contested) → it has become unavoidable; it must be settled
  critical (demands resolution now / decisive evidence at hand) → the settling is imminent
Terminal forms scale too: resolved = conclusively answered / thesis affirmed / finding confirmed;
subverted = reversed / thesis overturned / finding contradicted / superseded by newer evidence.

COMMITMENT: Below escalating = can abandon. At escalating+ = must resolve.
  Prune stale threads (5+ scenes silent, below escalating). Keep 3-6 committed; 10+ = noise.
  Touch 2-4 threads per scene. Committed threads have priority.
`;
}

/**
 * Build a bandwidth-based thread health report for the LLM.
 * Surfaces activeArcs, staleness, and lifecycle stage to guide
 * which threads should receive narrative bandwidth in the next arc.
 */
export function buildThreadHealthPrompt(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): string {
  const terminalStatuses = new Set(THREAD_TERMINAL_STATUSES as readonly string[]);

  // Count total arcs in the narrative so far
  const totalArcs = Object.keys(narrative.arcs).length || 1;

  // Compute per-thread metrics from scene history
  const threadFirstSeen: Record<string, number> = {};
  const threadLastSeen: Record<string, number> = {};
  const threadArcSets: Record<string, Set<string>> = {};
  let sceneCount = 0;

  for (let i = 0; i <= currentIndex && i < resolvedKeys.length; i++) {
    const scene = narrative.scenes[resolvedKeys[i]];
    if (!scene) continue;
    sceneCount++;
    for (const tm of scene.threadDeltas) {
      if (threadFirstSeen[tm.threadId] === undefined) threadFirstSeen[tm.threadId] = sceneCount;
      threadLastSeen[tm.threadId] = sceneCount;
      if (!threadArcSets[tm.threadId]) threadArcSets[tm.threadId] = new Set();
      threadArcSets[tm.threadId].add(scene.arcId);
    }
  }

  const allThreads = Object.values(narrative.threads);
  const resolved = allThreads.filter((t) => terminalStatuses.has(t.status));
  const active = allThreads.filter((t) => !terminalStatuses.has(t.status));

  if (active.length === 0 && resolved.length === 0) return '';

  const lines: string[] = [
    `THREAD BANDWIDTH — ${active.length} active, ${resolved.length} resolved, ${totalArcs} arcs elapsed`,
    '',
  ];

  // Sort by staleness (lowest bandwidth ratio first = most neglected)
  const sorted = active
    .map((t) => {
      const activeArcs = threadArcSets[t.id]?.size ?? 0;
      const bandwidthRatio = totalArcs > 0 ? activeArcs / totalArcs : 0;
      const scenesSinceLast = threadLastSeen[t.id] !== undefined ? sceneCount - threadLastSeen[t.id] : sceneCount;
      const age = threadFirstSeen[t.id] !== undefined ? sceneCount - threadFirstSeen[t.id] + 1 : 0;
      return { ...t, bandwidthRatio, scenesSinceLast, age };
    })
    .sort((a, b) => a.bandwidthRatio - b.bandwidthRatio);

  for (const t of sorted) {
    const stale = t.bandwidthRatio < 0.3;
    const critical = stale && (t.status === 'active' || t.status === 'critical');
    const discardCandidate = stale && (t.status === 'latent' || t.status === 'seeded');
    const flag = critical ? ' [!] EMERGENCY — active/critical thread starved of bandwidth'
      : discardCandidate ? ' [?] STALE — consider discarding or advancing'
      : '';

    lines.push(`"${t.description}" [${t.id}] ${t.status}`);
    lines.push(`  activeArcs: ${threadArcSets[t.id]?.size ?? 0}/${totalArcs} (${Math.round(t.bandwidthRatio * 100)}%) | age: ${t.age} scenes | silent: ${t.scenesSinceLast} scenes${flag}`);

    // Recent thread log nodes
    const logNodes = Object.values(t.threadLog?.nodes ?? {});
    const recentNodes = logNodes.slice(-ENTITY_LOG_CONTEXT_LIMIT);
    if (recentNodes.length > 0) {
      lines.push(`  log: ${recentNodes.map((n) => `[${n.type}] ${n.content.slice(0, 60)}`).join(' | ')}`);
    }

    if (t.dependents.length > 0) {
      const depDescs = t.dependents.map((depId) => narrative.threads[depId]).filter(Boolean).map((dep) => `[${dep.id}]`);
      if (depDescs.length > 0) lines.push(`  ↔ Converges: ${depDescs.join(', ')}`);
    }
    lines.push('');
  }

  lines.push(`Progress: ${resolved.length}/${allThreads.length} resolved`);
  return lines.join('\n');
}

/**
 * Extract irreversible state transitions from scene history and format them
 * as a "SPENT BEATS" prompt section. This tells the LLM what narrative
 * territory is already cashed in and must not be restaged.
 */
export function buildCompletedBeatsPrompt(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): string {
  const terminalStatuses = new Set(THREAD_TERMINAL_STATUSES as readonly string[]);

  type Beat = { sceneIdx: number; from: string; to: string; summary: string; events: string[] };
  const threadBeats: Record<string, Beat[]> = {};

  let sceneIdx = 0;
  for (let i = 0; i <= currentIndex && i < resolvedKeys.length; i++) {
    const scene = narrative.scenes[resolvedKeys[i]];
    if (!scene) continue;
    sceneIdx++;

    for (const tm of scene.threadDeltas) {
      if (tm.from === tm.to) continue;
      if (!threadBeats[tm.threadId]) threadBeats[tm.threadId] = [];
      threadBeats[tm.threadId].push({
        sceneIdx,
        from: tm.from,
        to: tm.to,
        summary: scene.summary?.slice(0, 100) ?? '',
        events: scene.events?.slice(0, 3) ?? [],
      });
    }
  }

  const threadIds = Object.keys(threadBeats).filter((id) => threadBeats[id].length > 0);
  if (threadIds.length === 0) return '';

  const lines: string[] = [
    'SPENT BEATS — these transitions are CLOSED. Do NOT restage, re-discover, or write "deepening" scenes.',
    'Next scene for any thread MUST change state: new complication, reversal, cost, or consequence.',
    '',
  ];

  for (const tid of threadIds) {
    const thread = narrative.threads[tid];
    if (!thread) continue;
    const beats = threadBeats[tid];

    const chain = beats.map((b) => `${b.to} (${b.sceneIdx})`).join(' → ');
    const currentStatus = beats.length > 0 ? beats[beats.length - 1].to : thread.status;
    const isTerminal = terminalStatuses.has(currentStatus);
    const label = isTerminal ? `[${currentStatus.toUpperCase()}]` : `[${currentStatus}]`;

    lines.push(`"${thread.description.slice(0, 50)}" [${tid}] ${label}`);
    lines.push(`  ${beats[0].from} → ${chain}`);

    for (const b of beats) {
      if (b.summary) {
        lines.push(`  S${b.sceneIdx}: ${b.summary}${b.events.length ? ` [${b.events.join(', ')}]` : ''}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
