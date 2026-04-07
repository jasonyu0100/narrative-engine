import type {
  NarrativeState, Scene, ForceSnapshot, CubeCornerKey,
  Character, Location, Thread,
  BeatSampler,
  PropositionBaseCategory,
} from '@/types/narrative';
import { NARRATIVE_CUBE, isScene, resolveEntry } from '@/types/narrative';
import { computeSamplerFromPlans } from '@/lib/beat-profiles';
import {
  computeForceSnapshots,
  computeRawForceTotals,
  computeDeliveryCurve,
  computeSwingMagnitudes,
  classifyNarrativeShape,
  classifyArchetype,
  classifyScale,
  classifyWorldDensity,
  detectCubeCorner,
  gradeForces,
  FORCE_REFERENCE_MEANS,
  computeThreadStatuses,
  type DeliveryPoint,
  type NarrativeShape,
  type ForceGrades,
  type NarrativeArchetype,
  type NarrativeScale,
  type WorldDensity,
} from '@/lib/narrative-utils';

// ── Types ──────────────────────────────────────────────────────────────────────

export type Segment = {
  /** Segment index (0-based) */
  index: number;
  /** Start scene index (inclusive) */
  startIdx: number;
  /** End scene index (inclusive) */
  endIdx: number;
  /** Delivery points for this segment */
  delivery: DeliveryPoint[];
  /** Dominant force in this segment */
  dominantForce: 'payoff' | 'change' | 'knowledge';
  /** Key thread mutations in this segment */
  threadChanges: { threadId: string; from: string; to: string; sceneIdx: number }[];
  /** Peaks within this segment */
  peakIndices: number[];
  /** Average delivery in this segment */
  avgDelivery: number;
  /** Scene summaries for key moments */
  keyScenes: { idx: number; summary: string; delivery: number }[];
};

export type PeakInfo = {
  /** Scene index in the full scene array */
  sceneIdx: number;
  scene: Scene;
  delivery: DeliveryPoint;
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
  delivery: DeliveryPoint;
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
  deliveryCurve: DeliveryPoint[];
  shape: NarrativeShape;
  swings: number[];

  segments: Segment[];
  peaks: PeakInfo[];
  troughs: TroughInfo[];

  cubeDistribution: Record<CubeCornerKey, number>;
  cubeTransitions: { from: CubeCornerKey; to: CubeCornerKey; count: number }[];

  threadLifecycles: ThreadLifecycle[];
  /** Thread convergence edges for braiding diagram */
  threadConvergences: { fromId: string; toId: string }[];
  topCharacters: { character: Character; sceneCount: number }[];
  topLocations: { location: Location; sceneCount: number }[];

  overallGrades: ForceGrades;
  archetype: NarrativeArchetype;
  scale: NarrativeScale;
  density: WorldDensity;
  arcGrades: ArcGrade[];

  /** Beat profile sampler computed from scene plans (null if no plans) */
  beatSampler: BeatSampler | null;
  /** Ordered sequence of beat functions from all scene plans */
  beatSequence: string[];

  /** Proposition classification data */
  propositionTotals: Record<PropositionBaseCategory, number>;
  propositionCount: number;
  /** Per-arc proposition distribution (arc name → base category counts) */
  propositionByArc: { arcName: string; totals: Record<PropositionBaseCategory, number>; total: number }[];
  /** Per-scene base category counts for timeline visualization */
  propositionTimeline: { sceneIdx: number; totals: Record<PropositionBaseCategory, number>; total: number }[];

  /** ID → name lookup maps for resolving scene references */
  characterNames: Record<string, string>;
  locationNames: Record<string, string>;
  threadDescriptions: Record<string, string>;
};

// ── Computation ────────────────────────────────────────────────────────────────

function dominantForce(p: number, c: number, k: number): 'payoff' | 'change' | 'knowledge' {
  if (p >= c && p >= k) return 'payoff';
  if (c >= p && c >= k) return 'change';
  return 'knowledge';
}

export function computeSlidesData(
  narrative: NarrativeState,
  resolvedEntryKeys: string[],
): SlidesData {
  // Resolve ordered scenes
  const scenes: Scene[] = resolvedEntryKeys
    .map((k) => resolveEntry(narrative, k))
    .filter((e): e is Scene => !!e && isScene(e));

  const n = scenes.length;

  // Force snapshots (z-score normalized)
  const forceMap = computeForceSnapshots(scenes);
  const forceSnapshots = scenes.map((s) => forceMap[s.id] ?? { payoff: 0, change: 0, knowledge: 0 });

  // Raw forces
  const rawForces = computeRawForceTotals(scenes);

  // Delivery curve
  const deliveryCurve = computeDeliveryCurve(forceSnapshots);

  // Narrative shape (based on delivery curve)
  const shape = classifyNarrativeShape(deliveryCurve.map((d) => d.delivery));

  // Swings from mean-normalised raw forces (preserves cross-series differences)
  const rawForceSnapshots = rawForces.payoff.map((_, i) => ({
    payoff: rawForces.payoff[i],
    change: rawForces.change[i],
    knowledge: rawForces.knowledge[i],
  }));
  const swings = computeSwingMagnitudes(rawForceSnapshots, FORCE_REFERENCE_MEANS);

  // Peaks and valleys
  const peakIndices = deliveryCurve.filter((e) => e.isPeak).map((e) => e.index);
  const valleyIndices = deliveryCurve.filter((e) => e.isValley).map((e) => e.index);

  // Segments: split at valleys (use z-score normalized forces for classification)
  const segments = buildSegments(scenes, deliveryCurve, forceSnapshots, valleyIndices);

  // Peak info — fall back to absolute max delivery if no prominent peaks detected
  let peaks = buildPeakInfos(scenes, deliveryCurve, forceSnapshots, narrative);
  if (peaks.length === 0 && deliveryCurve.length > 0) {
    const maxPoint = deliveryCurve.reduce((best, e) => (e.delivery > best.delivery ? e : best), deliveryCurve[0]);
    const scene = scenes[maxPoint.index];
    const f = forceSnapshots[maxPoint.index];
    const corner = detectCubeCorner(f);
    peaks = [{
      sceneIdx: maxPoint.index,
      scene,
      delivery: maxPoint,
      forces: f,
      cubeCorner: { key: corner.key, name: corner.name, description: corner.description },
      threadChanges: scene.threadMutations.map((tm) => ({ threadId: tm.threadId, from: tm.from, to: tm.to })),
      relationshipChanges: scene.relationshipMutations.map((rm) => ({
        from: rm.from, to: rm.to, type: rm.type, delta: rm.valenceDelta,
      })),
      dominantForce: dominantForce(f.payoff, f.change, f.knowledge),
    }];
  }

  // Trough info — fall back to absolute min delivery if no valleys detected
  let troughs = buildTroughInfos(scenes, deliveryCurve, forceSnapshots, peakIndices, narrative);
  if (troughs.length === 0 && deliveryCurve.length > 1) {
    const minPoint = deliveryCurve.reduce((best, e) => (e.delivery < best.delivery ? e : best), deliveryCurve[0]);
    const scene = scenes[minPoint.index];
    const f = forceSnapshots[minPoint.index];
    const corner = detectCubeCorner(f);
    const nextPeak = peakIndices.find((pi) => pi > minPoint.index);
    const scenesToNextPeak = nextPeak !== undefined ? nextPeak - minPoint.index : scenes.length - minPoint.index;
    let recoveryForce: TroughInfo['recoveryForce'] = null;
    if (minPoint.index + 3 < forceSnapshots.length) {
      const dp = forceSnapshots[minPoint.index + 3].payoff - f.payoff;
      const dc = forceSnapshots[minPoint.index + 3].change - f.change;
      const dk = forceSnapshots[minPoint.index + 3].knowledge - f.knowledge;
      const maxDelta = Math.max(dp, dc, dk);
      if (maxDelta > 0) {
        recoveryForce = dp === maxDelta ? 'payoff' : dc === maxDelta ? 'change' : 'knowledge';
      }
    }
    troughs = [{
      sceneIdx: minPoint.index,
      scene,
      delivery: minPoint,
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
  const threadLifecycles = buildThreadLifecycles(narrative, scenes, resolvedEntryKeys);

  // Thread convergences
  const threadConvergences: SlidesData['threadConvergences'] = [];
  const convSet = new Set<string>();
  for (const t of Object.values(narrative.threads)) {
    for (const depId of t.dependents) {
      if (!narrative.threads[depId]) continue;
      const key = [t.id, depId].sort().join('|');
      if (!convSet.has(key)) {
        convSet.add(key);
        threadConvergences.push({ fromId: t.id, toId: depId });
      }
    }
  }

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
    const ak = indices.map((i) => rawForces.knowledge[i]);
    const as_ = indices.map((i) => swings[i]);
    arcGrades.push({
      arcId,
      arcName: arc.name,
      sceneCount: indices.length,
      grades: gradeForces(ap, ac, ak, as_),
    });
  }

  const overallGrades = gradeForces(rawForces.payoff, rawForces.change, rawForces.knowledge, swings);

  // Beat profile data from scene plans
  const beatSampler = computeSamplerFromPlans(scenes);
  const beatSequence: string[] = [];
  for (const s of scenes) {
    const latestPlan = s.planVersions?.[s.planVersions.length - 1]?.plan;
    if (latestPlan?.beats) {
      for (const b of latestPlan.beats) beatSequence.push(b.fn);
    }
  }

  // Proposition classification data — lightweight counts from plans (no embeddings needed)
  // The actual classification with embeddings happens in proposition-classify.ts
  // Here we just count propositions per scene/arc for the slides
  const propositionTotals: Record<PropositionBaseCategory, number> = { Anchor: 0, Seed: 0, Close: 0, Texture: 0 };
  let propositionCount = 0;
  const propositionTimeline: SlidesData['propositionTimeline'] = [];
  const arcPropMap = new Map<string, { arcName: string; totals: Record<PropositionBaseCategory, number>; total: number }>();

  // These are populated later by the classification hook if available
  // For now, count raw propositions per scene for the timeline shape
  for (let si = 0; si < scenes.length; si++) {
    const s = scenes[si];
    const plan = s.planVersions?.[s.planVersions.length - 1]?.plan;
    if (!plan?.beats) {
      propositionTimeline.push({ sceneIdx: si, totals: { Anchor: 0, Seed: 0, Close: 0, Texture: 0 }, total: 0 });
      continue;
    }
    let sceneTotal = 0;
    for (const b of plan.beats) {
      sceneTotal += b.propositions?.length ?? 0;
    }
    propositionCount += sceneTotal;
    // Default: all uncategorized until classification runs
    propositionTimeline.push({ sceneIdx: si, totals: { Anchor: 0, Seed: 0, Close: 0, Texture: 0 }, total: sceneTotal });
  }

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
    deliveryCurve,
    shape,
    swings,
    segments,
    peaks,
    troughs,
    cubeDistribution,
    cubeTransitions,
    threadLifecycles,
    threadConvergences,
    topCharacters,
    topLocations,
    overallGrades: overallGrades,
    archetype: classifyArchetype(overallGrades),
    scale: classifyScale(scenes.length),
    density: classifyWorldDensity(
      scenes.length,
      Object.keys(narrative.characters).length,
      Object.keys(narrative.locations).length,
      Object.keys(narrative.threads).length,
      Object.keys(narrative.worldKnowledge?.nodes ?? {}).length,
    ),
    arcGrades,
    beatSampler,
    beatSequence,
    propositionTotals,
    propositionCount,
    propositionByArc: Array.from(arcPropMap.values()),
    propositionTimeline,
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
  dlvPts: DeliveryPoint[],
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

    const segDelivery = dlvPts.slice(startIdx, endIdx + 1);
    const segPeaks = segDelivery.filter((e) => e.isPeak).map((e) => e.index);

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

    // Key scenes: peaks + highest delivery scenes
    const keyScenes = segDelivery
      .filter((e) => e.isPeak || e.delivery === Math.max(...segDelivery.map((se) => se.delivery)))
      .slice(0, 3)
      .map((e) => ({
        idx: e.index,
        summary: scenes[e.index]?.summary ?? '',
        delivery: e.delivery,
      }));

    segments.push({
      index: i,
      startIdx,
      endIdx,
      delivery: segDelivery,
      dominantForce: dominantForce(segPayoff, segChange, segKnowledge),
      threadChanges,
      peakIndices: segPeaks,
      avgDelivery: avg(segDelivery.map((e) => e.delivery)),
      keyScenes,
    });
  }

  return segments;
}

function buildPeakInfos(
  scenes: Scene[],
  delivery: DeliveryPoint[],
  forces: ForceSnapshot[],
  narrative: NarrativeState,
): PeakInfo[] {
  return delivery
    .filter((e) => e.isPeak)
    .map((e) => {
      const scene = scenes[e.index];
      const f = forces[e.index];
      const corner = detectCubeCorner(f);
      return {
        sceneIdx: e.index,
        scene,
        delivery: e,
        forces: f,
        cubeCorner: { key: corner.key, name: corner.name, description: corner.description },
        threadChanges: scene.threadMutations.map((tm) => ({ threadId: tm.threadId, from: tm.from, to: tm.to })),
        relationshipChanges: scene.relationshipMutations.map((rm) => ({
          from: rm.from, to: rm.to, type: rm.type, delta: rm.valenceDelta,
        })),
        dominantForce: dominantForce(f.payoff, f.change, f.knowledge),
      };
    })
    .sort((a, b) => b.delivery.delivery - a.delivery.delivery);
}

function buildTroughInfos(
  scenes: Scene[],
  delivery: DeliveryPoint[],
  forces: ForceSnapshot[],
  peakIndices: number[],
  narrative: NarrativeState,
): TroughInfo[] {
  return delivery
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
        const dk = forces[e.index + 3].knowledge - f.knowledge;
        const maxDelta = Math.max(dp, dc, dk);
        if (maxDelta > 0) {
          recoveryForce = dp === maxDelta ? 'payoff' : dc === maxDelta ? 'change' : 'knowledge';
        }
      }

      return {
        sceneIdx: e.index,
        scene,
        delivery: e,
        forces: f,
        cubeCorner: { key: corner.key, name: corner.name, description: corner.description },
        scenesToNextPeak,
        recoveryForce,
      };
    })
    .sort((a, b) => a.delivery.delivery - b.delivery.delivery);
}

function buildThreadLifecycles(
  narrative: NarrativeState,
  scenes: Scene[],
  resolvedEntryKeys: string[],
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
