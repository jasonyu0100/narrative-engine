import type { NarrativeState, BranchEvaluation, SceneEval, SceneVerdict, Scene, Arc, Branch } from '@/types/narrative';
import { resolveEntry, isScene, isWorldBuild } from '@/types/narrative';
import { nextId } from '@/lib/narrative-utils';
import { callGenerate, SYSTEM_PROMPT } from './api';
import { parseJson } from './json';
import { GENERATE_MODEL, PROSE_CONCURRENCY } from '@/lib/constants';
import { branchContext } from './context';

// ── Types ────────────────────────────────────────────────────────────────────

export type ReconstructionStep = {
  sceneId: string;
  verdict: SceneVerdict;
  status: 'pending' | 'running' | 'done' | 'skipped';
};

export type ReconstructionProgress = {
  phase: 'preparing' | 'restructuring' | 'processing' | 'done';
  steps: ReconstructionStep[];
  completed: number;
  total: number;
  branchId: string | null;
};

export type ReconstructionCallbacks = {
  onProgress: (progress: ReconstructionProgress) => void;
  onSceneReady: (scene: Scene, action: 'keep' | 'edited' | 'rewritten') => void;
  onBranchCreated: (branch: Branch, scenes: Scene[], arcs: Record<string, Arc>) => void;
};

// ── Parallel batch helper ────────────────────────────────────────────────────

async function parallelBatch<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
  cancelledRef: { current: boolean },
): Promise<void> {
  let idx = 0;
  const run = async () => {
    while (idx < items.length) {
      if (cancelledRef.current) return;
      const i = idx++;
      await fn(items[i]);
    }
  };
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(workers);
}

// ── Reconstruction engine ────────────────────────────────────────────────────

/**
 * Reconstruct a branch based on evaluation verdicts.
 *
 * - Preserves world commits in their original timeline positions
 * - Copies "ok" scenes instantly
 * - Edits "edit" scenes in parallel — keeps structure, rewrites prose
 * - Rewrites "rewrite" scenes in parallel — regenerates structure from scratch
 * - Drops "cut" scenes
 * - Scenes stay after the world commit that introduced their entities
 */
export async function reconstructBranch(
  narrative: NarrativeState,
  resolvedKeys: string[],
  evaluation: BranchEvaluation,
  callbacks: ReconstructionCallbacks,
  cancelledRef: { current: boolean },
): Promise<{ branchId: string; branch: Branch; scenes: Scene[]; arcs: Record<string, Arc> }> {
  // Build verdict lookup
  const verdictMap = new Map<string, SceneEval>();
  for (const ev of evaluation.sceneEvals) {
    verdictMap.set(ev.sceneId, ev);
  }

  // Walk the full resolved timeline preserving world commits in order.
  // Only include world builds owned by the source branch itself — inherited
  // ones come from the parent chain and would be duplicated if included here.
  type TimelineItem =
    | { type: 'world_build'; id: string }
    | { type: 'scene'; index: number; scene: Scene; verdict: SceneVerdict; reason: string; newId: string };

  const items: TimelineItem[] = [];
  const allExistingSceneIds = new Set(Object.keys(narrative.scenes));
  const usedNewIds = new Set<string>();
  const sceneEntries: Extract<TimelineItem, { type: 'scene' }>[] = [];
  const cutSceneIds: string[] = [];

  // Entries owned by the source branch (not inherited from parents)
  const sourceBranch = narrative.branches[evaluation.branchId];
  const ownedEntryIds = new Set(sourceBranch?.entryIds ?? []);

  for (const key of resolvedKeys) {
    const entry = resolveEntry(narrative, key);
    if (!entry) continue;

    if (isWorldBuild(entry)) {
      // Only include world builds owned by the source branch
      if (ownedEntryIds.has(entry.id)) {
        items.push({ type: 'world_build', id: entry.id });
      }
    } else if (isScene(entry)) {
      const ev = verdictMap.get(entry.id);
      const verdict = ev?.verdict ?? 'ok';
      if (verdict === 'cut') {
        cutSceneIds.push(entry.id);
        continue;
      }

      const newId = nextId('S', [...allExistingSceneIds, ...usedNewIds], 3);
      usedNewIds.add(newId);

      const item: Extract<TimelineItem, { type: 'scene' }> = {
        type: 'scene',
        index: sceneEntries.length,
        scene: entry,
        verdict,
        reason: ev?.reason ?? '',
        newId,
      };
      items.push(item);
      sceneEntries.push(item);
    }
  }

  // Build progress steps — include cuts as instantly done
  const steps: ReconstructionStep[] = [
    ...sceneEntries.map((s) => ({
      sceneId: s.scene.id,
      verdict: s.verdict,
      status: s.verdict === 'ok' ? 'done' as const : 'pending' as const,
    })),
    ...cutSceneIds.map((id) => ({
      sceneId: id,
      verdict: 'cut' as SceneVerdict,
      status: 'done' as const,
    })),
  ];
  const total = steps.filter((s) => s.verdict !== 'ok' && s.verdict !== 'cut').length;
  let completed = 0;

  // Create new branch
  const newBranchId = nextId('BR', Object.keys(narrative.branches));
  const newBranch: Branch = {
    id: newBranchId,
    name: (() => {
      const base = sourceBranch?.name ?? 'main';
      // Strip existing version suffix to avoid stacking
      const stripped = base.replace(/\s+v\d+$/, '');
      // Find highest existing version for this base name
      const existing = Object.values(narrative.branches)
        .map((b) => b.name)
        .filter((n) => n === stripped || n.startsWith(`${stripped} v`));
      const maxVersion = existing.reduce((max, n) => {
        const m = n.match(/\sv(\d+)$/);
        return m ? Math.max(max, parseInt(m[1], 10)) : max;
      }, existing.length > 0 ? 1 : 0);
      return `${stripped} v${maxVersion + 1}`;
    })(),
    parentBranchId: sourceBranch?.parentBranchId ?? null,
    forkEntryId: sourceBranch?.forkEntryId ?? null,
    entryIds: [], // set below
    createdAt: Date.now(),
  };

  const progress: ReconstructionProgress = {
    phase: 'preparing',
    steps,
    completed: 0,
    total,
    branchId: newBranchId,
  };
  callbacks.onProgress({ ...progress });

  // ── Phase 1: Build scene array with new IDs, preserve order ────────────
  progress.phase = 'restructuring';
  callbacks.onProgress({ ...progress });

  const newScenes: Scene[] = sceneEntries.map((s) => ({ ...s.scene, id: s.newId }));
  const arcSceneMap = new Map<string, string[]>();
  for (const s of sceneEntries) {
    const list = arcSceneMap.get(s.scene.arcId) ?? [];
    list.push(s.newId);
    arcSceneMap.set(s.scene.arcId, list);
  }

  const newArcs: Record<string, Arc> = {};
  for (const [arcId, sceneIds] of arcSceneMap) {
    const original = narrative.arcs[arcId];
    if (original) newArcs[arcId] = { ...original, sceneIds };
  }

  // Branch entryIds: world builds + scenes interleaved in original order
  newBranch.entryIds = items.map((item) =>
    item.type === 'world_build' ? item.id : item.newId,
  );

  // Notify — ok scenes are already ready
  for (const s of sceneEntries) {
    if (s.verdict === 'ok') callbacks.onSceneReady(newScenes[s.index], 'keep');
  }
  callbacks.onBranchCreated(newBranch, newScenes, newArcs);

  // ── Phase 2: Process edits + rewrites in parallel ──────────────────────
  progress.phase = 'processing';
  callbacks.onProgress({ ...progress });

  const workItems = sceneEntries.filter((s) => s.verdict !== 'ok');

  await parallelBatch(workItems, PROSE_CONCURRENCY, async (item) => {
    if (cancelledRef.current) return;

    const step = steps.find((s) => s.sceneId === item.scene.id);
    if (step) step.status = 'running';
    callbacks.onProgress({ ...progress, completed, steps: [...steps] });

    try {
      if (item.verdict === 'edit') {
        // Edit: tighten summary, events, mutations — preserve core structure
        const edited = await editSceneSummary(
          narrative, resolvedKeys, item.scene, item.reason, evaluation,
          item.index, sceneEntries,
        );
        newScenes[item.index] = { ...edited, id: item.newId, arcId: item.scene.arcId };
        callbacks.onSceneReady(newScenes[item.index], 'edited');
      } else if (item.verdict === 'rewrite') {
        // Rewrite: regenerate full structure from scratch
        const rewritten = await rewriteSceneStructure(
          narrative, resolvedKeys, item.scene, item.reason, evaluation,
          item.index, sceneEntries,
        );
        newScenes[item.index] = { ...rewritten, id: item.newId, arcId: item.scene.arcId };
        callbacks.onSceneReady(newScenes[item.index], 'rewritten');
      }
    } catch (err) {
      console.warn(`[reconstruct] ${item.verdict} failed for ${item.scene.id}:`, err);
    }

    if (step) step.status = 'done';
    completed++;
    callbacks.onProgress({ ...progress, completed, steps: [...steps] });
  }, cancelledRef);

  progress.phase = 'done';
  callbacks.onProgress({ ...progress, completed });

  return { branchId: newBranchId, branch: newBranch, scenes: newScenes, arcs: newArcs };
}

// ── Scene summary edit (lightweight) ─────────────────────────────────────────

/**
 * Edit a scene's summary, events, and mutations in place.
 * Keeps POV, location, and participants — tightens the content based on
 * the evaluation reason. Much cheaper than a full rewrite.
 */
async function editSceneSummary(
  narrative: NarrativeState,
  resolvedKeys: string[],
  scene: Scene,
  reason: string,
  evaluation: BranchEvaluation,
  timelineIndex: number,
  timeline: { scene: Scene; verdict: SceneVerdict; reason: string }[],
): Promise<Scene> {
  const sceneIdx = resolvedKeys.indexOf(scene.id);
  const contextIndex = sceneIdx >= 0 ? sceneIdx : resolvedKeys.length - 1;
  const ctx = branchContext(narrative, resolvedKeys, contextIndex);

  const prevScene = timelineIndex > 0 ? timeline[timelineIndex - 1].scene : null;
  const nextScene = timelineIndex < timeline.length - 1 ? timeline[timelineIndex + 1].scene : null;

  const surroundingContext = [
    prevScene ? `PREVIOUS SCENE (${prevScene.id}): ${prevScene.summary}` : '',
    `CURRENT SCENE TO EDIT (${scene.id}): ${scene.summary}`,
    nextScene ? `NEXT SCENE (${nextScene.id}): ${nextScene.summary}` : '',
  ].filter(Boolean).join('\n');

  const prompt = `${ctx}

You are editing a scene as part of a branch reconstruction. This scene has the right core idea but needs tightening. You must KEEP the same POV character, location, and participants. You may adjust the summary, events, and mutations to fix the issue.

EVALUATION REASON: ${reason}
${evaluation.repetitions.length > 0 ? `PATTERNS TO AVOID: ${evaluation.repetitions.join('; ')}` : ''}

${surroundingContext}

CURRENT SCENE STRUCTURE (keep povId, locationId, participantIds unchanged):
${JSON.stringify({
  povId: scene.povId,
  locationId: scene.locationId,
  participantIds: scene.participantIds,
  events: scene.events,
  threadMutations: scene.threadMutations,
  continuityMutations: scene.continuityMutations,
  relationshipMutations: scene.relationshipMutations,
  summary: scene.summary,
}, null, 2)}

Edit this scene to fix the evaluation issue. You MUST:
- Keep povId, locationId, and participantIds exactly as they are
- Address the evaluation reason directly
- Maintain continuity with surrounding scenes
- Vary any repetitive beats flagged above

Return JSON with ONLY the fields you are changing (omit unchanged fields):
{
  "events": ["event_tag"],
  "threadMutations": [{"threadId": "T-XX", "from": "status", "to": "status"}],
  "continuityMutations": [{"characterId": "C-XX", "nodeId": "K-NEW-001", "action": "added", "content": "what they learned", "nodeType": "type"}],
  "relationshipMutations": [{"from": "C-XX", "to": "C-YY", "type": "description", "valenceDelta": 0.1}],
  "summary": "3-5 sentences — every sentence needs a named character + physical action verb + concrete consequence. No sentences ending in emotions or realizations. Use character NAMES and location NAMES."
}`;

  const raw = await callGenerate(prompt, SYSTEM_PROMPT, 1500, 'editSceneSummary', GENERATE_MODEL);
  const parsed = parseJson(raw, 'editSceneSummary') as Partial<Scene>;

  return {
    ...scene,
    events: parsed.events ?? scene.events,
    threadMutations: parsed.threadMutations ?? scene.threadMutations,
    continuityMutations: parsed.continuityMutations ?? scene.continuityMutations,
    relationshipMutations: parsed.relationshipMutations ?? scene.relationshipMutations,
    worldKnowledgeMutations: parsed.worldKnowledgeMutations ?? scene.worldKnowledgeMutations,
    summary: parsed.summary ?? scene.summary,
    // Clear prose/plan — they were based on old summary
    prose: undefined,
    plan: undefined,
    proseScore: undefined,
  };
}

// ── Scene structure rewrite (full) ───────────────────────────────────────────

async function rewriteSceneStructure(
  narrative: NarrativeState,
  resolvedKeys: string[],
  scene: Scene,
  reason: string,
  evaluation: BranchEvaluation,
  timelineIndex: number,
  timeline: { scene: Scene; verdict: SceneVerdict; reason: string }[],
): Promise<Scene> {
  const sceneIdx = resolvedKeys.indexOf(scene.id);
  const contextIndex = sceneIdx >= 0 ? sceneIdx : resolvedKeys.length - 1;
  const ctx = branchContext(narrative, resolvedKeys, contextIndex);

  const prevScene = timelineIndex > 0 ? timeline[timelineIndex - 1].scene : null;
  const nextScene = timelineIndex < timeline.length - 1 ? timeline[timelineIndex + 1].scene : null;

  const surroundingContext = [
    prevScene ? `PREVIOUS SCENE (${prevScene.id}): ${prevScene.summary}` : '',
    `CURRENT SCENE TO REWRITE (${scene.id}): ${scene.summary}`,
    nextScene ? `NEXT SCENE (${nextScene.id}): ${nextScene.summary}` : '',
  ].filter(Boolean).join('\n');

  const prompt = `${ctx}

You are rewriting a single scene's structure as part of a branch reconstruction. The scene was flagged for rewrite during evaluation.

EVALUATION REASON: ${reason}
${evaluation.thematicQuestion ? `THEMATIC QUESTION: "${evaluation.thematicQuestion}"` : ''}
${evaluation.repetitions.length > 0 ? `PATTERNS TO AVOID: ${evaluation.repetitions.join('; ')}` : ''}

${surroundingContext}

ORIGINAL SCENE STRUCTURE:
${JSON.stringify({
  locationId: scene.locationId,
  povId: scene.povId,
  participantIds: scene.participantIds,
  events: scene.events,
  threadMutations: scene.threadMutations,
  continuityMutations: scene.continuityMutations,
  relationshipMutations: scene.relationshipMutations,
  summary: scene.summary,
}, null, 2)}

Rewrite this scene to fix the issues identified. You may:
- Change the POV character
- Change the location
- Alter which threads are mutated and how
- Change the emotional register and events
- Rewrite the summary entirely

But you MUST:
- Keep the scene at the same position in the timeline (between previous and next scene)
- Use only existing character, location, and thread IDs from the context above
- Maintain continuity with surrounding scenes
- Address the evaluation reason directly

Return JSON (same scene structure):
{
  "locationId": "L-XX",
  "povId": "C-XX",
  "participantIds": ["C-XX"],
  "events": ["event_tag"],
  "threadMutations": [{"threadId": "T-XX", "from": "status", "to": "status"}],
  "continuityMutations": [{"characterId": "C-XX", "nodeId": "K-NEW-001", "action": "added", "content": "what they learned", "nodeType": "type"}],
  "relationshipMutations": [{"from": "C-XX", "to": "C-YY", "type": "description", "valenceDelta": 0.1}],
  "worldKnowledgeMutations": {"addedNodes": [], "addedEdges": []},
  "summary": "3-5 sentences — every sentence needs a named character + physical action verb + concrete consequence. No sentences ending in emotions or realizations. Use character NAMES and location NAMES."
}`;

  const raw = await callGenerate(prompt, SYSTEM_PROMPT, 2000, 'rewriteSceneStructure', GENERATE_MODEL);
  const parsed = parseJson(raw, 'rewriteSceneStructure') as Partial<Scene>;

  return {
    ...scene,
    locationId: parsed.locationId ?? scene.locationId,
    povId: parsed.povId ?? scene.povId,
    participantIds: parsed.participantIds ?? scene.participantIds,
    events: parsed.events ?? scene.events,
    threadMutations: parsed.threadMutations ?? scene.threadMutations,
    continuityMutations: parsed.continuityMutations ?? scene.continuityMutations,
    relationshipMutations: parsed.relationshipMutations ?? scene.relationshipMutations,
    worldKnowledgeMutations: parsed.worldKnowledgeMutations ?? scene.worldKnowledgeMutations,
    summary: parsed.summary ?? scene.summary,
    prose: undefined,
    plan: undefined,
    proseScore: undefined,
  };
}
