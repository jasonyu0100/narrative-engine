import type {
  NarrativeState,
  AutoConfig,
  AutoAction,
  AutoActionWeight,
  AutoEndCondition,
  ForceSnapshot,
  Scene,
  CubeCornerKey,
} from '@/types/narrative';
import { isScene, NARRATIVE_CUBE } from '@/types/narrative';
import { detectCubeCorner, computeForceSnapshots } from '@/lib/narrative-utils';

// ── Terminal thread statuses ────────────────────────────────────────────────
const TERMINAL_STATUSES = new Set(['resolved', 'done', 'subverted', 'closed', 'abandoned']);
const ACTIVE_STATUSES = new Set(['surfacing', 'escalating', 'critical', 'fractured', 'converging', 'threatened']);

function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.has(status.toLowerCase());
}

function isActive(status: string): boolean {
  return ACTIVE_STATUSES.has(status.toLowerCase());
}

// ── Objective multipliers for cube corners ──────────────────────────────────
// Bias action selection toward the high-level goal.
// High-stakes corners (H__) tend toward resolution/climax.
// Low-stakes corners (L__) tend toward exploration/open-endedness.
const OBJECTIVE_MULTIPLIERS: Record<string, Record<CubeCornerKey, number>> = {
  resolve_threads: {
    HHH: 1.4, HHL: 1.6, HLH: 1.0, HLL: 1.2,
    LHH: 0.4, LHL: 0.6, LLH: 0.3, LLL: 0.8,
  },
  explore_and_resolve: {
    HHH: 1.0, HHL: 1.0, HLH: 1.0, HLL: 1.0,
    LHH: 1.0, LHL: 1.0, LLH: 1.0, LLL: 1.0,
  },
  open_ended: {
    HHH: 0.6, HHL: 0.5, HLH: 0.8, HLL: 0.4,
    LHH: 1.5, LHL: 1.2, LLH: 1.4, LLL: 1.0,
  },
};

// ── Composite tension from force snapshot ───────────────────────────────────
function compositeTension(f: ForceSnapshot): number {
  return f.stakes * 0.4 + f.pacing * 0.3 + f.variety * 0.3;
}

// ── Euclidean distance between two force snapshots ──────────────────────────
function forceDistance(a: ForceSnapshot, b: ForceSnapshot): number {
  const ds = a.stakes - b.stakes;
  const dp = a.pacing - b.pacing;
  const dv = a.variety - b.variety;
  return Math.sqrt(ds * ds + dp * dp + dv * dv);
}

// ── Check end conditions ────────────────────────────────────────────────────
export function checkEndConditions(
  narrative: NarrativeState,
  resolvedKeys: string[],
  config: AutoConfig,
  startingSceneCount = 0,
  startingArcCount = 0,
): AutoEndCondition | null {
  for (const cond of config.endConditions) {
    switch (cond.type) {
      case 'scene_count': {
        const scenesThisRun = resolvedKeys.length - startingSceneCount;
        if (scenesThisRun >= cond.target) return cond;
        break;
      }
      case 'all_threads_resolved': {
        const threads = Object.values(narrative.threads);
        if (threads.length > 0 && threads.every((t) => isTerminal(t.status))) return cond;
        break;
      }
      case 'arc_count': {
        const arcsThisRun = Object.keys(narrative.arcs).length - startingArcCount;
        if (arcsThisRun >= cond.target) return cond;
        break;
      }
      case 'manual_stop':
        break; // only triggered by user
    }
  }
  return null;
}

// ── Check if world expansion is due (interval-based) ────────────────────────
export function isWorldBuildDue(
  narrative: NarrativeState,
  resolvedKeys: string[],
  config: AutoConfig,
): boolean {
  if (config.worldBuildInterval === 0) return false;

  const allArcIds = Object.keys(narrative.arcs);
  const lastWorldBuildIdx = resolvedKeys.findLastIndex((k) => narrative.worldBuilds[k] != null);

  let arcsSinceLastWorldBuild: number;
  if (lastWorldBuildIdx < 0) {
    arcsSinceLastWorldBuild = allArcIds.length;
  } else {
    const scenesAfter = resolvedKeys.slice(lastWorldBuildIdx + 1)
      .map((k) => narrative.scenes[k])
      .filter(Boolean);
    const arcIdsAfter = new Set(scenesAfter.map((s) => s.arcId));
    arcsSinceLastWorldBuild = arcIdsAfter.size;
  }

  return arcsSinceLastWorldBuild >= config.worldBuildInterval;
}

// ── Decision engine ─────────────────────────────────────────────────────────
// Scores all 8 cube corners as possible narrative directions.
export function evaluateNarrativeState(
  narrative: NarrativeState,
  resolvedKeys: string[],
  _currentIndex: number,
  config: AutoConfig,
): AutoActionWeight[] {
  const scenes = resolvedKeys.map((k) => narrative.scenes[k]).filter(Boolean).filter(isScene) as Scene[];
  const threads = Object.values(narrative.threads);
  const characters = Object.values(narrative.characters);
  const objectiveMult = OBJECTIVE_MULTIPLIERS[config.objective] ?? OBJECTIVE_MULTIPLIERS.explore_and_resolve;

  // ── Current force state ─────────────────────────────────────────────────
  const forceMap = computeForceSnapshots(scenes);
  const lastScene = scenes[scenes.length - 1];
  const currentForce = (lastScene ? forceMap[lastScene.id] : null) ?? { stakes: 0, pacing: 0, variety: 0 };
  const currentCorner = detectCubeCorner(currentForce);

  // ── Thread analysis ─────────────────────────────────────────────────────
  const activeThreads = threads.filter((t) => isActive(t.status));
  const dormantThreads = threads.filter((t) => t.status.toLowerCase() === 'dormant');

  const threadLastMutated: Record<string, number> = {};
  scenes.forEach((scene, idx) => {
    for (const tm of scene.threadMutations) {
      threadLastMutated[tm.threadId] = idx;
    }
  });

  const stagnantThreads = activeThreads.filter((t) => {
    const lastMut = threadLastMutated[t.id] ?? -1;
    return (scenes.length - 1 - lastMut) >= config.threadStagnationThreshold;
  });

  // ── Tension curve analysis ──────────────────────────────────────────────
  const recentWindow = scenes.slice(-5);
  const avgTension = recentWindow.length > 0
    ? recentWindow.reduce((sum, s) => sum + compositeTension(forceMap[s.id] ?? { stakes: 0, pacing: 0, variety: 0 }), 0) / recentWindow.length
    : 0;

  const tensionTrend = recentWindow.length >= 3
    ? compositeTension(forceMap[recentWindow[recentWindow.length - 1].id] ?? { stakes: 0, pacing: 0, variety: 0 }) -
      compositeTension(forceMap[recentWindow[0].id] ?? { stakes: 0, pacing: 0, variety: 0 })
    : 0;

  // ── Character coverage ──────────────────────────────────────────────────
  const anchorCharacters = characters.filter((c) => c.role === 'anchor');
  const recentSceneWindow = scenes.slice(-config.minScenesBetweenCharacterFocus);
  const recentParticipants = new Set(recentSceneWindow.flatMap((s) => s.participantIds));
  const neglectedAnchors = config.characterRotationEnabled
    ? anchorCharacters.filter((c) => !recentParticipants.has(c.id))
    : [];

  // ── Force drift detection ──────────────────────────────────────────────
  const driftWindow = scenes.slice(-4);
  let upwardDriftCount = 0;
  if (driftWindow.length >= 3) {
    for (const key of ['stakes', 'pacing', 'variety'] as const) {
      let rising = true;
      for (let i = 1; i < driftWindow.length; i++) {
        if ((forceMap[driftWindow[i].id]?.[key] ?? 0) < (forceMap[driftWindow[i - 1].id]?.[key] ?? 0)) {
          rising = false;
          break;
        }
      }
      if (rising) upwardDriftCount++;
    }
  }
  const hasForceDrift = upwardDriftCount >= 2;

  // ── High-force saturation detection ────────────────────────────────────
  const forceAvg = (currentForce.stakes + currentForce.pacing + currentForce.variety) / 3;
  const forcesHigh = forceAvg > 0.7;

  // ── Post-climax detection ─────────────────────────────────────────────
  const isPostClimax = recentWindow.length >= 3 &&
    compositeTension(forceMap[recentWindow[0].id] ?? { stakes: 0, pacing: 0, variety: 0 }) > 0.75 &&
    tensionTrend < -0.15;

  // ── Score each cube corner ────────────────────────────────────────────
  const ALL_CORNERS: CubeCornerKey[] = ['HHH', 'HHL', 'HLH', 'HLL', 'LHH', 'LHL', 'LLH', 'LLL'];
  const scores: AutoActionWeight[] = [];

  for (const key of ALL_CORNERS) {
    const corner = NARRATIVE_CUBE[key];
    let score = 0.5; // base score
    const reasons: string[] = [];

    // ── 1. Distance bonus: prefer corners that move the narrative ──────
    const dist = forceDistance(currentForce, corner.forces);
    // Sweet spot: moderate distance (0.8–1.5) is ideal. Too close = stagnant, too far = jarring
    if (dist < 0.3) {
      score -= 0.2;
      reasons.push('too close to current state');
    } else if (dist > 0.5 && dist < 2.0) {
      score += 0.15;
    }

    // ── 2. Avoid the current corner (narrative variety) ────────────────
    if (key === currentCorner.key) {
      score -= 0.3;
      reasons.push('already in this corner');
    }

    // ── 3. Thread-driven signals ──────────────────────────────────────
    const isHighStakes = corner.forces.stakes > 0;
    const isLowStakes = corner.forces.stakes < 0;
    const isHighPacing = corner.forces.pacing > 0;
    const isLowPacing = corner.forces.pacing < 0;
    const isHighVariety = corner.forces.variety > 0;
    const isLowVariety = corner.forces.variety < 0;

    // Too many active threads → favor high-stakes corners that force resolution
    if (activeThreads.length > config.maxActiveThreads && isHighStakes) {
      score += 0.2;
      reasons.push(`${activeThreads.length} active threads need stakes`);
    }

    // Stagnant threads → favor high-pacing corners to shake things up
    if (stagnantThreads.length > 0 && isHighPacing) {
      score += 0.15;
      reasons.push(`${stagnantThreads.length} stagnant threads need pacing`);
    }

    // Dormant threads → high-variety corners can surface them
    if (dormantThreads.length > 2 && isHighVariety) {
      score += 0.1;
      reasons.push(`${dormantThreads.length} dormant threads — variety can surface them`);
    }

    // ── 4. Tension management ─────────────────────────────────────────
    if (avgTension > 0.65 && isLowStakes && isLowPacing) {
      score += 0.3;
      reasons.push(`tension high (${avgTension.toFixed(2)}) — needs relief`);
    }

    if (avgTension < 0.25 && isHighStakes) {
      score += 0.25;
      reasons.push(`tension low (${avgTension.toFixed(2)}) — needs stakes`);
    }

    // ── 5. Force drift correction ─────────────────────────────────────
    if (hasForceDrift && isLowStakes && isLowPacing) {
      score += 0.3;
      reasons.push('force drift — suppressing with low-energy corner');
    }
    if (forcesHigh && isHighStakes && isHighPacing) {
      score *= 0.4;
      reasons.push('forces already saturated');
    }

    // ── 6. Post-climax: strongly favor rest/recovery corners ──────────
    if (isPostClimax) {
      if (key === 'LLL' || key === 'LLH' || key === 'LHL') {
        score += 0.4;
        reasons.push('post-climax recovery');
      } else if (isHighStakes && isHighPacing) {
        score *= 0.2;
        reasons.push('suppressed post-climax');
      }
    }

    // ── 7. Neglected characters → favor low-pacing introspective corners
    if (neglectedAnchors.length > 0 && isLowPacing && isLowVariety) {
      score += 0.1;
      reasons.push(`${neglectedAnchors.length} neglected anchors — good for character focus`);
    }

    // ── 8. Apply objective multiplier ─────────────────────────────────
    score *= objectiveMult[key];

    scores.push({
      action: key,
      score: Math.max(0, Math.min(1, score)),
      reason: reasons.join('; ') || corner.name,
    });
  }

  return scores.sort((a, b) => b.score - a.score);
}

/** Pick the scene count for an auto-generated arc based on the target cube corner */
export function pickArcLength(config: AutoConfig, action: AutoAction): number {
  const corner = NARRATIVE_CUBE[action];
  const f = corner.forces;

  // High pacing → longer arcs (more scenes to carry the pace)
  // Low pacing → shorter arcs (brief, contemplative)
  // High stakes → medium-long (need scenes to build/release stakes)
  if (f.pacing > 0 && f.stakes > 0) {
    // High energy corners (HHH, HHL) — full arcs
    return config.maxArcLength;
  } else if (f.pacing < 0 && f.stakes < 0) {
    // Low energy corners (LLL, LLH) — brief interludes
    return config.minArcLength;
  } else {
    // Mixed — medium length
    return Math.ceil((config.minArcLength + config.maxArcLength) / 2);
  }
}

/**
 * For cube-based actions, the action IS the cube goal.
 */
export function pickCubeGoal(
  action: AutoAction,
  _narrative: NarrativeState,
  _resolvedKeys: string[],
  _config: AutoConfig,
): CubeCornerKey {
  return action;
}

/** Build the action-specific direction hint injected into AI prompts */
export function buildActionDirective(
  action: AutoAction,
  narrative: NarrativeState,
  resolvedKeys: string[],
  config: AutoConfig,
): string {
  const corner = NARRATIVE_CUBE[action];
  const threads = Object.values(narrative.threads);
  const activeThreads = threads.filter((t) => isActive(t.status));
  const scenes = resolvedKeys.map((k) => narrative.scenes[k]).filter(Boolean).filter(isScene) as Scene[];
  const stagnantThreads = activeThreads.filter((t) => {
    let lastMut = -1;
    scenes.forEach((s, idx) => {
      if (s.threadMutations.some((tm) => tm.threadId === t.id)) lastMut = idx;
    });
    return (scenes.length - 1 - lastMut) >= config.threadStagnationThreshold;
  });

  const toneClause = config.toneGuidance ? `\nTone: ${config.toneGuidance}` : '';
  const constraintClause = config.narrativeConstraints ? `\nConstraints: ${config.narrativeConstraints}` : '';
  const directionClause = config.arcDirectionPrompt ? `\nNORTH STAR DIRECTION (always steer the narrative toward this): ${config.arcDirectionPrompt}` : '';

  // Objective-specific guidance
  const objectiveClause = config.objective === 'resolve_threads'
    ? '\nOBJECTIVE: Drive all threads toward resolution and bring the story to a satisfying conclusion. Do not introduce new complications or expand the world — focus on closing existing storylines.'
    : config.objective === 'open_ended'
    ? '\nOBJECTIVE: Keep the story open and evolving. Prioritize introducing new elements, complications, and world expansion over resolving threads.'
    : '';

  // World build seed clause
  const worldBuildSeed = buildWorldBuildSeedClause(narrative, resolvedKeys, config);

  // Thread context for relevant corners
  const threadContext = stagnantThreads.length > 0
    ? `\nStagnant threads needing attention: ${stagnantThreads.map((t) => t.description).join(', ')}.`
    : '';

  // Corner-specific directives
  const cornerDirectives: Record<CubeCornerKey, string> = {
    HHH: `PEAK CRISIS — ${corner.description} Push all forces to maximum. Multiple threads should collide simultaneously. This is the most intense, chaotic moment of the narrative.${threadContext}`,
    HHL: `CLIMAX — ${corner.description} Drive toward a decisive payoff. High stakes and rapid pace, but the situation is clear and focused. This is the moment of maximum reader investment.${threadContext}`,
    HLH: `SLOW BURN — ${corner.description} Maintain high stakes but withhold action. Let tension simmer through ambiguity and restraint. Characters face mounting stakes in uncertain territory.${threadContext}`,
    HLL: `LOCKED IN — ${corner.description} Everything is loaded but static. Characters endure, suppress, or wait under immense stakes. Build pre-climactic tension through constraint and inevitability.${threadContext}`,
    LHH: `EXPLORATION — ${corner.description} Fast-paced discovery through unstable new territory. Low stakes but high energy and surprise. World-building arcs, early adventure, open possibility space.`,
    LHL: `CRUISE — ${corner.description} Efficient narrative throughput. Move the story forward at a steady clip among known elements. Training, travel, episodic sequences.`,
    LLH: `LIMINAL — ${corner.description} Contemplative and transitional. Characters in unfamiliar conditions without clear direction. Plant seeds, explore the unknown quietly.`,
    LLL: `REST — ${corner.description} Breathing room after intensity. Focus on recovery, character relationships, and subtle foreshadowing. Plant seeds for future conflict.`,
  };

  return `${cornerDirectives[action]}${worldBuildSeed}${objectiveClause}${toneClause}${constraintClause}${directionClause}`;
}

/** Build a clause that references unused world-build elements to weave into arcs */
function buildWorldBuildSeedClause(
  narrative: NarrativeState,
  resolvedKeys: string[],
  config: AutoConfig,
): string {
  const worldBuilds = Object.values(narrative.worldBuilds);
  if (worldBuilds.length === 0) return '';

  const scenes = resolvedKeys.map((k) => narrative.scenes[k]).filter(Boolean).filter(isScene) as Scene[];
  const usedCharIds = new Set(scenes.flatMap((s) => s.participantIds));
  const usedLocIds = new Set(scenes.map((s) => s.locationId));
  const mutatedThreadIds = new Set(scenes.flatMap((s) => s.threadMutations.map((tm) => tm.threadId)));

  const unusedChars: string[] = [];
  const unusedLocs: string[] = [];
  const unusedThreads: string[] = [];

  for (const wb of worldBuilds) {
    for (const cid of wb.expansionManifest.characterIds) {
      if (!usedCharIds.has(cid)) {
        const c = narrative.characters[cid];
        if (c) unusedChars.push(`${c.name} (${c.role})`);
      }
    }
    for (const lid of wb.expansionManifest.locationIds) {
      if (!usedLocIds.has(lid)) {
        const l = narrative.locations[lid];
        if (l) unusedLocs.push(l.name);
      }
    }
    for (const tid of wb.expansionManifest.threadIds) {
      if (!mutatedThreadIds.has(tid)) {
        const t = narrative.threads[tid];
        if (t) unusedThreads.push(t.description);
      }
    }
  }

  if (unusedChars.length === 0 && unusedLocs.length === 0 && unusedThreads.length === 0) return '';

  const enforce = config.enforceWorldBuildUsage;
  const header = enforce
    ? '\nYou MUST incorporate at least one of these unused world-building elements into this arc:'
    : '\nConsider incorporating these unused world-building elements:';
  const parts: string[] = [header];
  if (unusedChars.length > 0) parts.push(`- Characters: ${unusedChars.slice(0, 4).join(', ')}`);
  if (unusedLocs.length > 0) parts.push(`- Locations: ${unusedLocs.slice(0, 3).join(', ')}`);
  if (unusedThreads.length > 0) parts.push(`- Threads: ${unusedThreads.slice(0, 3).join(', ')}`);

  return parts.join('\n');
}
