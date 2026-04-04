import type { NarrativeState, Scene, AlignmentIssue, AlignmentReport, AlignmentCategory, AlignmentSeverity, ContinuityPlan, ContinuityEdit } from '@/types/narrative';
import { REASONING_BUDGETS } from '@/types/narrative';
import { callGenerate } from './api';
import { rewriteSceneProse } from './prose';
import { ANALYSIS_MODEL, MAX_TOKENS_SMALL, ANALYSIS_TEMPERATURE } from '@/lib/constants';
import { parseJson } from './json';

// ── Window generation ────────────────────────────────────────────────────────

export type AlignmentWindow = {
  index: number;
  sceneIds: string[];
};

/** Build overlapping sliding windows over a scene list.
 *  windowSize=5, stride=3 → each scene appears in ~2 windows. */
export function buildAlignmentWindows(
  sceneIds: string[],
  windowSize: number,
  stride: number,
): AlignmentWindow[] {
  const windows: AlignmentWindow[] = [];
  for (let i = 0; i < sceneIds.length; i += stride) {
    const end = Math.min(i + windowSize, sceneIds.length);
    const ids = sceneIds.slice(i, end);
    if (ids.length >= 2) windows.push({ index: windows.length, sceneIds: ids });
    if (end >= sceneIds.length) break;
  }
  return windows;
}

// ── Single-window audit ──────────────────────────────────────────────────────

function buildWindowDigest(narrative: NarrativeState, scenes: Scene[]): string {
  return scenes.map((s, i) => {
    const pov = narrative.characters[s.povId]?.name ?? s.povId;
    const loc = narrative.locations[s.locationId]?.name ?? s.locationId;
    const participants = s.participantIds
      .map((id) => narrative.characters[id]?.name ?? id)
      .join(', ');

    const threads = s.threadMutations.map((tm) => {
      const thread = narrative.threads[tm.threadId];
      const label = thread?.description ?? tm.threadId;
      return `${label}: ${tm.from} → ${tm.to}`;
    }).join('; ');

    const movements = s.characterMovements
      ? Object.entries(s.characterMovements).map(([cid, m]) => {
          const name = narrative.characters[cid]?.name ?? cid;
          const dest = narrative.locations[m.locationId]?.name ?? m.locationId;
          return `${name} → ${dest} (${m.transition})`;
        }).join('; ')
      : '';

    const header = [
      `SCENE ${i + 1} [${s.id}]`,
      `  POV: ${pov} | Location: ${loc}`,
      `  Participants: ${participants}`,
      threads ? `  Thread mutations: ${threads}` : '',
      movements ? `  Movements: ${movements}` : '',
      `  Summary: ${s.summary}`,
    ].filter(Boolean).join('\n');

    const prose = s.prose ?? '(no prose generated)';
    return `${header}\n\n${prose}`;
  }).join('\n\n---\n\n');
}

type RawIssue = {
  category: string;
  severity: string;
  sceneIds: string[];
  summary: string;
  detail: string;
  fix: string;
};

const VALID_CATEGORIES: AlignmentCategory[] = [
  'character-state', 'voice-drift', 'timeline', 'spatial', 'thread-continuity', 'tone-shift',
  'missing-transition', 'state-reset', 'knowledge-leak', 'proximity', 'repetition',
];
const VALID_SEVERITIES: AlignmentSeverity[] = ['minor', 'moderate', 'major'];

/** Phase 1a: Audit a single window of consecutive scenes for continuity issues. */
export async function auditWindow(
  narrative: NarrativeState,
  window: AlignmentWindow,
): Promise<AlignmentIssue[]> {
  const scenes = window.sceneIds
    .map((id) => narrative.scenes[id])
    .filter((s): s is Scene => !!s && !!s.prose);

  if (scenes.length < 2) return [];

  const digest = buildWindowDigest(narrative, scenes);

  const systemPrompt = `You are a continuity editor auditing prose across consecutive scenes in a novel. You find both CONTRADICTIONS and GAPS — places where the connective tissue between scenes is missing, making the narrative feel like independently-written chapters rather than a flowing story. Return ONLY valid JSON — no markdown, no commentary.`;

  const prompt = `CONSECUTIVE SCENES TO AUDIT:

${digest}

---

Audit these scenes for CROSS-SCENE continuity problems. These scenes were generated in parallel, so they may lack connective glue. Look for three classes of problems:

**CONTRADICTIONS** — things that can't both be true:
- character-state: A character knows, possesses, or feels something in one scene that contradicts another
- timeline: Temporal impossibility or inconsistent passage of time
- spatial: Character appears in a location they couldn't have reached
- thread-continuity: A plot thread's status in prose contradicts its structural mutations
- knowledge-leak: Character acts on information they haven't learned yet in the prose

**GAPS** — missing connective tissue that makes scenes feel disconnected:
- missing-transition: Character is at location A in scene N and location B in scene N+1 with no travel, departure, or arrival. Or a character's emotional/physical state changes with no bridge.
- state-reset: An injury, exhaustion, emotional state, or consequence established in one scene is silently absent in the next. The prior state doesn't need to dominate — but it needs to EXIST.
- proximity: When multiple characters share a scene, the prose must establish WHERE they are relative to each other. Without spatial grounding, dialogue and action feels disembodied.
- voice-drift: Narrative voice, tone register, or POV discipline changes inconsistently between consecutive scenes
- tone-shift: Abrupt unearned mood change between consecutive scenes without narrative justification

**REDUNDANCY** — artifacts of parallel generation:
- repetition: The same beat, reveal, emotional realization, or descriptive passage occurs in multiple scenes. A character has the same epiphany twice, or the same information is presented as new in two different chapters. Parallel generation often produces duplicate moments because each scene was written without knowing the others existed.

**IMPORTANT**: If these scenes flow well and have no continuity problems, that is a GOOD outcome — return an empty issues array. Do NOT fabricate issues or flag minor stylistic preferences. Only flag genuine problems that would jar a reader.

Severity levels:
- minor: Noticeable to careful readers but doesn't break immersion
- moderate: Breaks immersion — readers will notice something is off
- major: Logical impossibility, or a gap so large it's disorienting

For each issue:
- sceneIds: the 2+ scene IDs involved (the scene boundary where the problem occurs)
- summary: one-line description
- detail: explain the problem with specific quotes from the prose showing the disconnect
- fix: what needs to be ADDED or changed — for gaps, describe what connective detail is missing (a line of travel, a wince of pain, a moment of reflection, a temporal anchor). Be specific enough to guide a rewrite.

Return JSON:
{
  "issues": [
    {
      "category": "state-reset",
      "severity": "moderate",
      "sceneIds": ["scene_id_1", "scene_id_2"],
      "summary": "Kael's sword wound silently disappears",
      "detail": "Scene 1 ends with 'blood still seeping through the makeshift bandage' but Scene 2 opens with Kael 'stretching easily' with no mention of the wound, bandaging, or pain",
      "fix": "Scene 2 needs physical acknowledgment of the wound — add discomfort when he moves, reference to rebandaging, or a brief note about healing time passing. The wound doesn't need to be central but it must exist in his body."
    },
    {
      "category": "missing-transition",
      "severity": "moderate",
      "sceneIds": ["scene_id_2", "scene_id_3"],
      "summary": "Mira teleports from the market to the mountain pass",
      "detail": "Scene 2 has Mira 'pushing through the crowd at the eastern market' and Scene 3 opens with her 'crouching behind a boulder on the mountain trail' with no travel between them",
      "fix": "Scene 3 needs an opening beat establishing the journey — even a single line about the climb, the time elapsed, or her state upon arrival. Alternatively Scene 2 could end with her departure from the market."
    }
  ]
}

If these scenes read well with no continuity problems, return {"issues": []}. An empty result is perfectly valid — not every window will have issues, and false positives waste rewrite budget.
Be thorough but precise — check every scene boundary for state carryover, but only flag genuine problems that would jar a reader.`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const raw = await callGenerate(prompt, systemPrompt, MAX_TOKENS_SMALL, `alignmentAudit:window${window.index}`, ANALYSIS_MODEL, reasoningBudget, true, ANALYSIS_TEMPERATURE);
  const parsed = parseJson(raw, 'alignmentAudit') as { issues: RawIssue[] };

  if (!Array.isArray(parsed.issues)) return [];

  return parsed.issues
    .filter((issue): issue is RawIssue =>
      !!issue &&
      typeof issue.summary === 'string' &&
      typeof issue.detail === 'string' &&
      typeof issue.fix === 'string' &&
      Array.isArray(issue.sceneIds) &&
      issue.sceneIds.length >= 2
    )
    .map((issue, i) => ({
      id: `w${window.index}_i${i}_${Date.now()}`,
      category: (VALID_CATEGORIES.includes(issue.category as AlignmentCategory)
        ? issue.category : 'character-state') as AlignmentCategory,
      severity: (VALID_SEVERITIES.includes(issue.severity as AlignmentSeverity)
        ? issue.severity : 'moderate') as AlignmentSeverity,
      sceneIds: issue.sceneIds,
      summary: issue.summary,
      detail: issue.detail,
      fix: issue.fix,
      confidence: 1,
    }));
}

// ── Cross-window deduplication ───────────────────────────────────────────────

function isDuplicate(a: AlignmentIssue, b: AlignmentIssue): boolean {
  if (a.category !== b.category) return false;
  const shared = a.sceneIds.filter((id) => b.sceneIds.includes(id));
  return shared.length >= 2;
}

export function deduplicateIssues(allIssues: AlignmentIssue[]): AlignmentIssue[] {
  const merged: AlignmentIssue[] = [];

  for (const issue of allIssues) {
    const existing = merged.find((m) => isDuplicate(m, issue));
    if (existing) {
      existing.confidence += 1;
      const sevOrder: AlignmentSeverity[] = ['minor', 'moderate', 'major'];
      if (sevOrder.indexOf(issue.severity) > sevOrder.indexOf(existing.severity)) {
        existing.severity = issue.severity;
      }
      for (const id of issue.sceneIds) {
        if (!existing.sceneIds.includes(id)) existing.sceneIds.push(id);
      }
      if (issue.detail.length > existing.detail.length) {
        existing.detail = issue.detail;
        existing.fix = issue.fix;
      }
    } else {
      merged.push({ ...issue });
    }
  }

  const sevOrder: AlignmentSeverity[] = ['major', 'moderate', 'minor'];
  merged.sort((a, b) => {
    const sevDiff = sevOrder.indexOf(a.severity) - sevOrder.indexOf(b.severity);
    if (sevDiff !== 0) return sevDiff;
    return b.confidence - a.confidence;
  });

  return merged;
}

// ── Progress ─────────────────────────────────────────────────────────────────

export type AlignmentPhase = 'align' | 'fix';

export type AlignmentProgress = {
  phase: AlignmentPhase;
  /** Current step label within the phase */
  step: string;
  completed: number;
  total: number;
};

// ── Phase 1: Align ───────────────────────────────────────────────────────────

/** Run overlapping window audits and deduplicate. */
export async function runAlignment(
  narrative: NarrativeState,
  sceneIds: string[],
  windowSize: number,
  stride: number,
  concurrency: number,
  onProgress?: (progress: AlignmentProgress) => void,
): Promise<AlignmentReport> {
  const windows = buildAlignmentWindows(sceneIds, windowSize, stride);
  let completedWindows = 0;
  let allIssues: AlignmentIssue[] = [];

  onProgress?.({ phase: 'align', step: 'Auditing windows', completed: 0, total: windows.length });

  let nextIdx = 0;
  const runWorker = async () => {
    while (true) {
      const idx = nextIdx++;
      if (idx >= windows.length) break;
      try {
        const issues = await auditWindow(narrative, windows[idx]);
        allIssues = allIssues.concat(issues);
      } catch (err) {
        console.error(`Alignment window ${idx} failed:`, err);
      }
      completedWindows++;
      onProgress?.({ phase: 'align', step: 'Auditing windows', completed: completedWindows, total: windows.length });
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, windows.length) }, () => runWorker()));

  onProgress?.({ phase: 'align', step: 'Deduplicating', completed: windows.length, total: windows.length });
  const deduplicated = deduplicateIssues(allIssues);

  return {
    id: `align_${Date.now()}`,
    createdAt: new Date().toISOString(),
    windowSize,
    stride,
    sceneIds,
    issues: deduplicated,
  };
}

// ── Continuity plan (programmatic merge) ─────────────────────────────────────

/** Programmatically merge alignment issues into a chronological edit plan.
 *  For each issue, assign it to the LATEST scene in its sceneIds list
 *  (fix the receiver, preserve earlier momentum). Group by scene, sort
 *  chronologically. The rewrite LLM — which sees the actual prose and
 *  neighbor context — handles the intelligence. */
export function buildContinuityPlan(report: AlignmentReport): ContinuityPlan {
  if (report.issues.length === 0) {
    return { id: `cont_${Date.now()}`, alignmentReportId: report.id, edits: [] };
  }

  const orderMap = new Map(report.sceneIds.map((id, i) => [id, i]));

  // For each issue, assign to the latest scene involved (fix the receiver)
  const sceneIssueMap = new Map<string, AlignmentIssue[]>();
  for (const issue of report.issues) {
    // Pick the latest scene in chronological order
    const sorted = [...issue.sceneIds].sort((a, b) => (orderMap.get(a) ?? 0) - (orderMap.get(b) ?? 0));
    const targetScene = sorted[sorted.length - 1];
    if (!targetScene) continue;
    const existing = sceneIssueMap.get(targetScene) ?? [];
    existing.push(issue);
    sceneIssueMap.set(targetScene, existing);
  }

  // Build edits in chronological order
  const edits: ContinuityEdit[] = [...sceneIssueMap.entries()]
    .sort((a, b) => (orderMap.get(a[0]) ?? 0) - (orderMap.get(b[0]) ?? 0))
    .map(([sceneId, issues]) => {
      // Build analysis from raw issues — the rewrite LLM has prose context
      const analysis = issues.map((issue) => {
        const conf = issue.confidence > 1 ? ` [confirmed ${issue.confidence}x]` : '';
        return `[${issue.severity.toUpperCase()}] ${issue.category}${conf}: ${issue.summary}\n${issue.detail}\nFix: ${issue.fix}`;
      }).join('\n\n');

      return {
        sceneId,
        issueIds: issues.map((i) => i.id),
        analysis,
      };
    });

  return {
    id: `cont_${Date.now()}`,
    alignmentReportId: report.id,
    edits,
  };
}

// ── Phase 3: Fix (helpers for the UI to drive) ──────────────────────────────

/** Build the analysis string for a single continuity edit.
 *  This feeds directly into rewriteSceneProse(). */
export function buildFixAnalysis(edit: ContinuityEdit, report: AlignmentReport): string {
  // Start with the synthesized analysis from the continuity plan
  const lines: string[] = [
    'CONTINUITY FIX — this rewrite adds missing connective tissue and resolves cross-scene inconsistencies.',
    'The primary goal is to make this scene flow naturally from the previous scene and into the next.',
    'ADD detail where needed (transitions, state carryover, physical consequences) rather than just removing contradictions.',
    'Preserve the scene\'s core events and narrative deliveries — only modify what is needed for continuity.',
    '',
    edit.analysis,
  ];

  // Append raw issue details for reference
  const relatedIssues = report.issues.filter((i) => edit.issueIds.includes(i.id));
  if (relatedIssues.length > 0) {
    lines.push('', '--- ORIGINAL ISSUES FOR REFERENCE ---');
    for (const issue of relatedIssues) {
      lines.push(`[${issue.severity.toUpperCase()}] ${issue.category}: ${issue.summary}`);
      lines.push(issue.detail);
    }
  }

  return lines.join('\n');
}

// ── Phase 3: Windowed parallel fix ───────────────────────────────────────────

export type FixResult = {
  sceneId: string;
  prose: string;
  changelog: string;
};

/** Apply continuity fixes using a sliding window — scenes within a window
 *  rewrite in parallel (they share context), windows advance sequentially
 *  so later windows see the prose updated by earlier ones.
 *
 *  This mirrors the same sliding-window principle as the audit phase:
 *  windowSize=5, stride=3 → overlapping windows, parallel within each. */
export async function runFixWindows(
  narrative: NarrativeState,
  plan: ContinuityPlan,
  report: AlignmentReport,
  resolvedKeys: string[],
  windowSize: number,
  stride: number,
  onProgress?: (progress: AlignmentProgress) => void,
  onSceneFixed?: (result: FixResult) => void,
  isCancelled?: () => boolean,
): Promise<FixResult[]> {
  if (plan.edits.length === 0) return [];

  // Build a set of scene IDs that have edits for quick lookup
  const editMap = new Map(plan.edits.map((e) => [e.sceneId, e]));

  // Get the full scene order from the report, filter to only scenes with edits
  const editSceneIds = report.sceneIds.filter((id) => editMap.has(id));
  const allResults: FixResult[] = [];

  // Build windows over the edit scene IDs
  const windows = buildAlignmentWindows(editSceneIds, windowSize, stride);
  const totalEdits = plan.edits.length;
  let completedEdits = 0;

  onProgress?.({ phase: 'fix', step: 'Fixing windows', completed: 0, total: totalEdits });

  // Track which scenes have already been fixed (by an earlier window)
  // to avoid double-rewriting scenes that appear in overlapping windows
  const fixedSceneIds = new Set<string>();

  for (const window of windows) {
    if (isCancelled?.()) break;

    // Filter to scenes not yet fixed in a prior window
    const windowEdits = window.sceneIds
      .filter((id) => !fixedSceneIds.has(id))
      .map((id) => editMap.get(id)!)
      .filter(Boolean);

    if (windowEdits.length === 0) continue;

    // Rewrite all scenes in this window in parallel
    const windowPromises = windowEdits.map(async (edit) => {
      if (isCancelled?.()) return;
      const s = narrative.scenes[edit.sceneId];
      if (!s?.prose) {
        completedEdits++;
        onProgress?.({ phase: 'fix', step: 'Fixing windows', completed: completedEdits, total: totalEdits });
        return;
      }

      try {
        const analysis = buildFixAnalysis(edit, report);
        const { prose, changelog } = await rewriteSceneProse(narrative, s, resolvedKeys, s.prose, analysis);
        const result: FixResult = { sceneId: edit.sceneId, prose, changelog };
        allResults.push(result);
        onSceneFixed?.(result);
      } catch (err) {
        console.error(`Fix failed for ${edit.sceneId}:`, err);
      }

      fixedSceneIds.add(edit.sceneId);
      completedEdits++;
      onProgress?.({ phase: 'fix', step: 'Fixing windows', completed: completedEdits, total: totalEdits });
    });

    // Wait for entire window to finish before advancing
    await Promise.all(windowPromises);
  }

  onProgress?.({ phase: 'fix', step: 'Done', completed: totalEdits, total: totalEdits });
  return allResults;
}
