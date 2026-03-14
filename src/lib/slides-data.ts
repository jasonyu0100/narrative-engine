import type {
  NarrativeState, Scene, ForceSnapshot, CubeCornerKey,
  Character, Location, Thread, ProseScore,
} from '@/types/narrative';
import { NARRATIVE_CUBE, isScene, resolveEntry } from '@/types/narrative';
import {
  computeForceSnapshots,
  computeRawForcetotals,
  computeEngagementCurve,
  computeSwingMagnitudes,
  classifyNarrativeShape,
  detectCubeCorner,
  gradeForces,
  computeThreadStatuses,
  FORCE_REFERENCE_MEANS,
  type EngagementPoint,
  type NarrativeShape,
  type ForceGrades,
} from '@/lib/narrative-utils';

// ── Types ──────────────────────────────────────────────────────────────────────

export type Segment = {
  /** Segment index (0-based) */
  index: number;
  /** Start scene index (inclusive) */
  startIdx: number;
  /** End scene index (inclusive) */
  endIdx: number;
  /** Engagement points for this segment */
  engagement: EngagementPoint[];
  /** Dominant force in this segment */
  dominantForce: 'payoff' | 'change' | 'knowledge';
  /** Key thread mutations in this segment */
  threadChanges: { threadId: string; from: string; to: string; sceneIdx: number }[];
  /** Peaks within this segment */
  peakIndices: number[];
  /** Average engagement in this segment */
  avgEngagement: number;
  /** Scene summaries for key moments */
  keyScenes: { idx: number; summary: string; engagement: number }[];
};

export type PeakInfo = {
  /** Scene index in the full scene array */
  sceneIdx: number;
  scene: Scene;
  engagement: EngagementPoint;
  forces: ForceSnapshot;
  cubeCorner: { key: CubeCornerKey; name: string; description: string };
  /** Thread mutations at this scene */
  threadChanges: { threadId: string; from: string; to: string }[];
  /** Relationship mutations at this scene */
  relationshipChanges: { from: string; to: string; type: string; delta: number }[];
  /** Force decomposition: which force contributed most */
  dominantForce: 'payoff' | 'change' | 'knowledge';
};

export type TroughInfo = {
  sceneIdx: number;
  scene: Scene;
  engagement: EngagementPoint;
  forces: ForceSnapshot;
  cubeCorner: { key: CubeCornerKey; name: string; description: string };
  /** How many scenes until next peak */
  scenesToNextPeak: number;
  /** Which force recovers first in the scenes after this trough */
  recoveryForce: 'payoff' | 'change' | 'knowledge' | null;
};

export type ThreadLifecycle = {
  threadId: string;
  description: string;
  /** Status at each scene index */
  statuses: { sceneIdx: number; status: string }[];
};

export type ArcGrade = {
  arcId: string;
  arcName: string;
  sceneCount: number;
  grades: ForceGrades;
};

export type SlidesData = {
  title: string;
  description: string;
  sceneCount: number;
  arcCount: number;
  characterCount: number;
  locationCount: number;
  threadCount: number;
  coverImageUrl?: string;

  scenes: Scene[];
  forceSnapshots: ForceSnapshot[];
  rawForces: { payoff: number[]; change: number[]; knowledge: number[] };
  engagementCurve: EngagementPoint[];
  shape: NarrativeShape;
  swings: number[];

  segments: Segment[];
  peaks: PeakInfo[];
  troughs: TroughInfo[];

  cubeDistribution: Record<CubeCornerKey, number>;
  cubeTransitions: { from: CubeCornerKey; to: CubeCornerKey; count: number }[];

  threadLifecycles: ThreadLifecycle[];
  topCharacters: { character: Character; sceneCount: number }[];
  topLocations: { location: Location; sceneCount: number }[];

  overallGrades: ForceGrades;
  arcGrades: ArcGrade[];
  avgProseScore: ProseScore | null;

  /** ID → name lookup maps for resolving scene references */
  characterNames: Record<string, string>;
  locationNames: Record<string, string>;
  threadDescriptions: Record<string, string>;
};

// ── Computation ────────────────────────────────────────────────────────────────

function dominantForce(p: number, c: number, v: number): 'payoff' | 'change' | 'knowledge' {
  if (p >= c && p >= v) return 'payoff';
  if (c >= p && c >= v) return 'change';
  return 'knowledge';
}

export function computeSlidesData(
  narrative: NarrativeState,
  resolvedSceneKeys: string[],
): SlidesData {
  // Resolve ordered scenes
  const scenes: Scene[] = resolvedSceneKeys
    .map((k) => resolveEntry(narrative, k))
    .filter((e): e is Scene => !!e && isScene(e));

  const n = scenes.length;

  // Force snapshots (z-score normalized)
  const forceMap = computeForceSnapshots(scenes);
  const forceSnapshots = scenes.map((s) => forceMap[s.id] ?? { payoff: 0, change: 0, knowledge: 0 });

  // Raw forces
  const rawForces = computeRawForcetotals(scenes);

  // Engagement curve
  const engagementCurve = computeEngagementCurve(forceSnapshots);

  // Narrative shape
  const shape = classifyNarrativeShape(engagementCurve);

  // Swings
  const rawForceSnapshots = rawForces.payoff.map((_, i) => ({
    payoff: rawForces.payoff[i],
    change: rawForces.change[i],
    knowledge: rawForces.knowledge[i],
  }));
  const swings = computeSwingMagnitudes(rawForceSnapshots, FORCE_REFERENCE_MEANS);

  // Peaks and valleys
  const peakIndices = engagementCurve.filter((e) => e.isPeak).map((e) => e.index);
  const valleyIndices = engagementCurve.filter((e) => e.isValley).map((e) => e.index);

  // Segments: split at valleys (use z-score normalized forces for classification)
  const segments = buildSegments(scenes, engagementCurve, forceSnapshots, valleyIndices);

  // Peak info — fall back to absolute max engagement if no prominent peaks detected
  let peaks = buildPeakInfos(scenes, engagementCurve, forceSnapshots, narrative);
  if (peaks.length === 0 && engagementCurve.length > 0) {
    const maxPoint = engagementCurve.reduce((best, e) => (e.engagement > best.engagement ? e : best), engagementCurve[0]);
    const scene = scenes[maxPoint.index];
    const f = forceSnapshots[maxPoint.index];
    const corner = detectCubeCorner(f);
    peaks = [{
      sceneIdx: maxPoint.index,
      scene,
      engagement: maxPoint,
      forces: f,
      cubeCorner: { key: corner.key, name: corner.name, description: corner.description },
      threadChanges: scene.threadMutations.map((tm) => ({ threadId: tm.threadId, from: tm.from, to: tm.to })),
      relationshipChanges: scene.relationshipMutations.map((rm) => ({
        from: rm.from, to: rm.to, type: rm.type, delta: rm.valenceDelta,
      })),
      dominantForce: dominantForce(f.payoff, f.change, f.knowledge),
    }];
  }

  // Trough info — fall back to absolute min engagement if no valleys detected
  let troughs = buildTroughInfos(scenes, engagementCurve, forceSnapshots, peakIndices, narrative);
  if (troughs.length === 0 && engagementCurve.length > 1) {
    const minPoint = engagementCurve.reduce((best, e) => (e.engagement < best.engagement ? e : best), engagementCurve[0]);
    const scene = scenes[minPoint.index];
    const f = forceSnapshots[minPoint.index];
    const corner = detectCubeCorner(f);
    const nextPeak = peakIndices.find((pi) => pi > minPoint.index);
    const scenesToNextPeak = nextPeak !== undefined ? nextPeak - minPoint.index : scenes.length - minPoint.index;
    let recoveryForce: TroughInfo['recoveryForce'] = null;
    if (minPoint.index + 3 < forceSnapshots.length) {
      const dp = forceSnapshots[minPoint.index + 3].payoff - f.payoff;
      const dc = forceSnapshots[minPoint.index + 3].change - f.change;
      const dv = forceSnapshots[minPoint.index + 3].knowledge - f.knowledge;
      const maxDelta = Math.max(dp, dc, dv);
      if (maxDelta > 0) {
        recoveryForce = dp === maxDelta ? 'payoff' : dc === maxDelta ? 'change' : 'knowledge';
      }
    }
    troughs = [{
      sceneIdx: minPoint.index,
      scene,
      engagement: minPoint,
      forces: f,
      cubeCorner: { key: corner.key, name: corner.name, description: corner.description },
      scenesToNextPeak,
      recoveryForce,
    }];
  }

  // Cube distribution & transitions
  const corners = forceSnapshots.map((f) => detectCubeCorner(f));
  const cubeDistribution = {} as Record<CubeCornerKey, number>;
  for (const key of Object.keys(NARRATIVE_CUBE) as CubeCornerKey[]) cubeDistribution[key] = 0;
  for (const c of corners) cubeDistribution[c.key]++;

  const transitionMap = new Map<string, number>();
  for (let i = 1; i < corners.length; i++) {
    const key = `${corners[i - 1].key}->${corners[i].key}`;
    transitionMap.set(key, (transitionMap.get(key) ?? 0) + 1);
  }
  const cubeTransitions = Array.from(transitionMap.entries())
    .map(([key, count]) => {
      const [from, to] = key.split('->') as [CubeCornerKey, CubeCornerKey];
      return { from, to, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  // Thread lifecycles
  const threadLifecycles = buildThreadLifecycles(narrative, scenes, resolvedSceneKeys);

  // Top characters by participation
  const charCounts = new Map<string, number>();
  for (const s of scenes) {
    for (const pid of s.participantIds) {
      charCounts.set(pid, (charCounts.get(pid) ?? 0) + 1);
    }
  }
  const topCharacters = Array.from(charCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, count]) => ({ character: narrative.characters[id], sceneCount: count }))
    .filter((c) => c.character);

  // Top locations
  const locCounts = new Map<string, number>();
  for (const s of scenes) {
    locCounts.set(s.locationId, (locCounts.get(s.locationId) ?? 0) + 1);
  }
  const topLocations = Array.from(locCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, count]) => ({ location: narrative.locations[id], sceneCount: count }))
    .filter((l) => l.location);

  // Grades
  const arcIds = Object.keys(narrative.arcs);
  const sceneIdToIdx = new Map(scenes.map((s, i) => [s.id, i]));
  const arcGrades: ArcGrade[] = [];
  for (const arcId of arcIds) {
    const arc = narrative.arcs[arcId];
    const indices = arc.sceneIds.map((sid) => sceneIdToIdx.get(sid)).filter((i): i is number => i !== undefined);
    if (indices.length === 0) continue;
    const ap = indices.map((i) => rawForces.payoff[i]);
    const ac = indices.map((i) => rawForces.change[i]);
    const av = indices.map((i) => rawForces.knowledge[i]);
    const as_ = indices.map((i) => swings[i]);
    arcGrades.push({
      arcId,
      arcName: arc.name,
      sceneCount: indices.length,
      grades: gradeForces(ap, ac, av, as_),
    });
  }

  const overallGrades = gradeForces(rawForces.payoff, rawForces.change, rawForces.knowledge, swings);

  // Average prose scores
  const proseScores = scenes.map((s) => s.proseScore).filter((p): p is ProseScore => !!p && typeof p.overall === 'number');
  const avgProseScore = proseScores.length > 0
    ? {
        overall: avg(proseScores.map((p) => p.overall)),
        voice: avg(proseScores.map((p) => p.voice)),
        pacing: avg(proseScores.map((p) => p.pacing)),
        dialogue: avg(proseScores.map((p) => p.dialogue)),
        sensory: avg(proseScores.map((p) => p.sensory)),
        mutation_coverage: avg(proseScores.map((p) => p.mutation_coverage)),
      }
    : null;

  return {
    title: narrative.title,
    description: narrative.description,
    sceneCount: n,
    arcCount: arcIds.length,
    characterCount: Object.keys(narrative.characters).length,
    locationCount: Object.keys(narrative.locations).length,
    threadCount: Object.keys(narrative.threads).length,
    coverImageUrl: narrative.coverImageUrl,
    scenes,
    forceSnapshots,
    rawForces,
    engagementCurve,
    shape,
    swings,
    segments,
    peaks,
    troughs,
    cubeDistribution,
    cubeTransitions,
    threadLifecycles,
    topCharacters,
    topLocations,
    overallGrades: overallGrades,
    arcGrades,
    avgProseScore,
    characterNames: Object.fromEntries(Object.entries(narrative.characters).map(([id, c]) => [id, c.name])),
    locationNames: Object.fromEntries(Object.entries(narrative.locations).map(([id, l]) => [id, l.name])),
    threadDescriptions: Object.fromEntries(Object.entries(narrative.threads).map(([id, t]) => [id, t.description])),
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function avg(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function buildSegments(
  scenes: Scene[],
  engagement: EngagementPoint[],
  forces: ForceSnapshot[],
  valleyIndices: number[],
): Segment[] {
  const n = scenes.length;
  if (n === 0) return [];

  // Build split points from valleys
  const splits = [0, ...valleyIndices.filter((v) => v > 0 && v < n - 1), n - 1];
  // Deduplicate and sort
  const uniqueSplits = Array.from(new Set(splits)).sort((a, b) => a - b);

  const segments: Segment[] = [];
  for (let i = 0; i < uniqueSplits.length - 1; i++) {
    const startIdx = i === 0 ? uniqueSplits[i] : uniqueSplits[i] + 1;
    const endIdx = uniqueSplits[i + 1];
    if (startIdx > endIdx) continue;

    const segEngagement = engagement.slice(startIdx, endIdx + 1);
    const segPeaks = segEngagement.filter((e) => e.isPeak).map((e) => e.index);

    // Average z-score normalized forces in segment
    const segForces = forces.slice(startIdx, endIdx + 1);
    const segPayoff = avg(segForces.map((f) => f.payoff));
    const segChange = avg(segForces.map((f) => f.change));
    const segKnowledge = avg(segForces.map((f) => f.knowledge));

    // Thread changes in this segment
    const threadChanges: Segment['threadChanges'] = [];
    for (let si = startIdx; si <= endIdx; si++) {
      for (const tm of scenes[si].threadMutations) {
        threadChanges.push({ threadId: tm.threadId, from: tm.from, to: tm.to, sceneIdx: si });
      }
    }

    // Key scenes: peaks + highest engagement scenes
    const keyScenes = segEngagement
      .filter((e) => e.isPeak || e.engagement === Math.max(...segEngagement.map((se) => se.engagement)))
      .slice(0, 3)
      .map((e) => ({
        idx: e.index,
        summary: scenes[e.index]?.summary ?? '',
        engagement: e.engagement,
      }));

    segments.push({
      index: i,
      startIdx,
      endIdx,
      engagement: segEngagement,
      dominantForce: dominantForce(segPayoff, segChange, segKnowledge),
      threadChanges,
      peakIndices: segPeaks,
      avgEngagement: avg(segEngagement.map((e) => e.engagement)),
      keyScenes,
    });
  }

  return segments;
}

function buildPeakInfos(
  scenes: Scene[],
  engagement: EngagementPoint[],
  forces: ForceSnapshot[],
  narrative: NarrativeState,
): PeakInfo[] {
  return engagement
    .filter((e) => e.isPeak)
    .map((e) => {
      const scene = scenes[e.index];
      const f = forces[e.index];
      const corner = detectCubeCorner(f);
      return {
        sceneIdx: e.index,
        scene,
        engagement: e,
        forces: f,
        cubeCorner: { key: corner.key, name: corner.name, description: corner.description },
        threadChanges: scene.threadMutations.map((tm) => ({ threadId: tm.threadId, from: tm.from, to: tm.to })),
        relationshipChanges: scene.relationshipMutations.map((rm) => ({
          from: rm.from, to: rm.to, type: rm.type, delta: rm.valenceDelta,
        })),
        dominantForce: dominantForce(f.payoff, f.change, f.knowledge),
      };
    })
    .sort((a, b) => b.engagement.engagement - a.engagement.engagement);
}

function buildTroughInfos(
  scenes: Scene[],
  engagement: EngagementPoint[],
  forces: ForceSnapshot[],
  peakIndices: number[],
  narrative: NarrativeState,
): TroughInfo[] {
  return engagement
    .filter((e) => e.isValley)
    .map((e) => {
      const scene = scenes[e.index];
      const f = forces[e.index];
      const corner = detectCubeCorner(f);

      // Find next peak
      const nextPeak = peakIndices.find((pi) => pi > e.index);
      const scenesToNextPeak = nextPeak !== undefined ? nextPeak - e.index : scenes.length - e.index;

      // Recovery force: check the next 3 scenes to see which force rises most
      let recoveryForce: TroughInfo['recoveryForce'] = null;
      if (e.index + 3 < forces.length) {
        const dp = forces[e.index + 3].payoff - f.payoff;
        const dc = forces[e.index + 3].change - f.change;
        const dv = forces[e.index + 3].knowledge - f.knowledge;
        const maxDelta = Math.max(dp, dc, dv);
        if (maxDelta > 0) {
          recoveryForce = dp === maxDelta ? 'payoff' : dc === maxDelta ? 'change' : 'knowledge';
        }
      }

      return {
        sceneIdx: e.index,
        scene,
        engagement: e,
        forces: f,
        cubeCorner: { key: corner.key, name: corner.name, description: corner.description },
        scenesToNextPeak,
        recoveryForce,
      };
    })
    .sort((a, b) => a.engagement.engagement - b.engagement.engagement);
}

function buildThreadLifecycles(
  narrative: NarrativeState,
  scenes: Scene[],
  resolvedSceneKeys: string[],
): ThreadLifecycle[] {
  const terminalStatuses = new Set(['resolved', 'subverted', 'abandoned']);
  const threads = Object.values(narrative.threads);

  return threads.map((thread) => {
    // Find all scenes that mutate this thread
    const mutations: { sceneIdx: number; from: string; to: string }[] = [];
    for (let i = 0; i < scenes.length; i++) {
      for (const tm of scenes[i].threadMutations) {
        if (tm.threadId === thread.id) {
          mutations.push({ sceneIdx: i, from: tm.from, to: tm.to });
        }
      }
    }

    if (mutations.length === 0) return null;

    // Build status timeline from first mutation to last (or terminal)
    const firstIdx = mutations[0].sceneIdx;
    const statuses: { sceneIdx: number; status: string }[] = [];

    // Start with the "from" status of the first mutation
    let currentStatus = mutations[0].from;
    let mutIdx = 0;

    for (let i = firstIdx; i < scenes.length; i++) {
      // Apply all mutations at this scene index
      while (mutIdx < mutations.length && mutations[mutIdx].sceneIdx === i) {
        currentStatus = mutations[mutIdx].to;
        mutIdx++;
      }
      statuses.push({ sceneIdx: i, status: currentStatus });

      // Stop after terminal status — thread is done
      if (terminalStatuses.has(currentStatus)) break;

      // Stop if no more mutations and we've gone past the last one by a gap
      // (thread goes silent — cap at last mutation + small buffer)
      if (mutIdx >= mutations.length && i > mutations[mutations.length - 1].sceneIdx) break;
    }

    return {
      threadId: thread.id,
      description: thread.description,
      statuses,
    };
  }).filter((tl): tl is ThreadLifecycle => tl !== null && tl.statuses.length > 0);
}
