import type {
  NarrativeState,
  AutoConfig,
  AutoAction,
  AutoActionWeight,
  AutoEndCondition,
  ForceSnapshot,
  Scene,
  Thread,
  Character,
  CubeCornerKey,
} from '@/types/narrative';
import { isScene, NARRATIVE_CUBE, THREAD_ACTIVE_STATUSES, THREAD_TERMINAL_STATUSES, THREAD_PRIMED_STATUSES } from '@/types/narrative';
import { detectCubeCorner, computeForceSnapshots } from '@/lib/narrative-utils';

// ── Thread status helpers (derived from canonical lists in narrative.ts) ─────
const TERMINAL_SET = new Set<string>(THREAD_TERMINAL_STATUSES);
const ACTIVE_SET = new Set<string>(THREAD_ACTIVE_STATUSES.filter((s) => s !== 'dormant'));
const PRIMED_SET = new Set<string>(THREAD_PRIMED_STATUSES);

function isTerminal(status: string): boolean {
  return TERMINAL_SET.has(status.toLowerCase());
}

function isActive(status: string): boolean {
  return ACTIVE_SET.has(status.toLowerCase());
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

// ── Thread maturity analysis ────────────────────────────────────────────────
// Scores each active thread 0–1 on how "ripe" it is for resolution.
type ThreadMaturity = { thread: Thread; score: number };

function computeThreadMaturity(
  narrative: NarrativeState,
  scenes: Scene[],
): ThreadMaturity[] {
  const threads = Object.values(narrative.threads);
  const activeThreads = threads.filter((t) => isActive(t.status));
  if (activeThreads.length === 0 || scenes.length === 0) return [];

  // Build per-thread stats from scene history
  const threadTransitions: Record<string, number> = {};
  const threadMutationCount: Record<string, number> = {};
  const threadFirstScene: Record<string, number> = {};
  const threadLastScene: Record<string, number> = {};

  scenes.forEach((scene, idx) => {
    for (const tm of scene.threadMutations) {
      threadMutationCount[tm.threadId] = (threadMutationCount[tm.threadId] ?? 0) + 1;
      if (tm.from !== tm.to) {
        threadTransitions[tm.threadId] = (threadTransitions[tm.threadId] ?? 0) + 1;
      }
      if (threadFirstScene[tm.threadId] === undefined) threadFirstScene[tm.threadId] = idx;
      threadLastScene[tm.threadId] = idx;
    }
  });

  return activeThreads.map((thread) => {
    const firstIdx = threadFirstScene[thread.id] ?? 0;
    const age = (scenes.length - firstIdx) / Math.max(scenes.length, 1);
    const transitions = Math.min((threadTransitions[thread.id] ?? 0) / 4, 1);
    const mutations = Math.min((threadMutationCount[thread.id] ?? 0) / 8, 1);

    // Status progression bonus
    const statusBonus = PRIMED_SET.has(thread.status.toLowerCase()) ? 0.25 : 0;

    // Anchor involvement in recent scenes (last 5)
    const recentScenes = scenes.slice(-5);
    const anchorIds = new Set(thread.anchors.map((a) => a.id));
    const anchorAppearances = recentScenes.filter((s) =>
      s.participantIds.some((pid) => anchorIds.has(pid)),
    ).length;
    const anchorInvolvement = recentScenes.length > 0 ? anchorAppearances / recentScenes.length : 0;

    const score = Math.min(1, age * 0.3 + transitions * 0.2 + mutations * 0.15 + statusBonus + anchorInvolvement * 0.1);
    return { thread, score };
  });
}

// ── Knowledge asymmetry analysis ────────────────────────────────────────────
// Detects dramatic information gaps using structural signals, not hardcoded types.
type KnowledgeOpportunity = {
  holderName: string;
  ignorantName: string;
  content: string;
  dramaticWeight: number;
};

function analyzeKnowledgeAsymmetries(
  narrative: NarrativeState,
  scenes: Scene[],
): KnowledgeOpportunity[] {
  const characters = Object.values(narrative.characters);
  if (characters.length < 2) return [];

  // Build a set of knowledge content per character for fast lookup
  const charKnowledge = new Map<string, Set<string>>();
  const charKnowledgeNodes = new Map<string, { content: string; index: number }[]>();
  for (const c of characters) {
    const contentSet = new Set(c.knowledge.nodes.map((n) => n.content));
    charKnowledge.set(c.id, contentSet);
    charKnowledgeNodes.set(c.id, c.knowledge.nodes.map((n, i) => ({ content: n.content, index: i })));
  }

  // Count how many characters know each piece of content (exclusivity)
  const contentHolderCount: Record<string, number> = {};
  for (const contentSet of charKnowledge.values()) {
    for (const content of contentSet) {
      contentHolderCount[content] = (contentHolderCount[content] ?? 0) + 1;
    }
  }

  // Build relationship valence lookup
  const relValence: Record<string, number> = {};
  for (const r of narrative.relationships) {
    relValence[`${r.from}→${r.to}`] = r.valence;
    relValence[`${r.to}→${r.from}`] = r.valence;
  }

  // Build shared-thread lookup
  const charThreads = new Map<string, Set<string>>();
  for (const c of characters) {
    charThreads.set(c.id, new Set(c.threadIds));
  }

  const opportunities: KnowledgeOpportunity[] = [];

  // For each pair of characters that share a thread or relationship
  for (let i = 0; i < characters.length; i++) {
    for (let j = i + 1; j < characters.length; j++) {
      const a = characters[i];
      const b = characters[j];

      // Must share a thread or relationship to be narratively relevant
      const aThreads = charThreads.get(a.id)!;
      const bThreads = charThreads.get(b.id)!;
      const sharedThreads = [...aThreads].filter((t) => bThreads.has(t));
      const relKey = `${a.id}→${b.id}`;
      const hasRelationship = relValence[relKey] !== undefined;

      if (sharedThreads.length === 0 && !hasRelationship) continue;

      const aKnows = charKnowledge.get(a.id)!;
      const bKnows = charKnowledge.get(b.id)!;

      // Find what A knows that B doesn't, and vice versa
      const checkAsymmetry = (holder: Character, ignorant: Character, holderSet: Set<string>, ignorantSet: Set<string>) => {
        for (const content of holderSet) {
          if (ignorantSet.has(content)) continue;

          // Structural weight factors
          const exclusivity = 1 / Math.max(contentHolderCount[content] ?? 1, 1);
          const tensionBonus = Math.max(0, -(relValence[`${holder.id}→${ignorant.id}`] ?? 0)) * 0.3;
          const threadProximity = sharedThreads.length > 0 ? 0.2 : 0;

          const weight = exclusivity * 0.5 + tensionBonus + threadProximity + 0.1;

          if (weight > 0.25) {
            opportunities.push({
              holderName: holder.name,
              ignorantName: ignorant.name,
              content,
              dramaticWeight: weight,
            });
          }
        }
      };

      checkAsymmetry(a, b, aKnows, bKnows);
      checkAsymmetry(b, a, bKnows, aKnows);
    }
  }

  // Sort by dramatic weight, return top opportunities
  return opportunities.sort((a, b) => b.dramaticWeight - a.dramaticWeight).slice(0, 10);
}

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
  const dormantThreads = threads.filter((t) => t.status.toLowerCase() === THREAD_ACTIVE_STATUSES[0]);

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

  // ── Thread maturity (primed for resolution) ───────────────────────────
  const maturityScores = computeThreadMaturity(narrative, scenes);
  const primedThreads = maturityScores.filter(
    (m) => m.score >= 0.6 && PRIMED_SET.has(m.thread.status.toLowerCase()),
  );

  // ── Knowledge asymmetries ────────────────────────────────────────────
  const knowledgeOpportunities = analyzeKnowledgeAsymmetries(narrative, scenes);
  const hasHighDramaOpportunities = knowledgeOpportunities.length > 0 && knowledgeOpportunities[0].dramaticWeight > 0.4;

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

    // Primed threads → boost high-stakes resolution corners for payoff
    if (primedThreads.length > 0 && isHighStakes) {
      const boost = Math.min(0.35, primedThreads.length * 0.12);
      score += boost;
      reasons.push(`${primedThreads.length} thread(s) primed for resolution`);
    }

    // Knowledge asymmetries → boost revelation corners (high-variety + high-stakes)
    if (hasHighDramaOpportunities && (isHighVariety || isHighStakes)) {
      score += 0.2;
      reasons.push('knowledge asymmetries create revelation opportunities');
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
  const directionClause = config.storyDirectionPrompt
    ? `\nSTORY DIRECTION (high-level trajectory guiding the entire narrative): ${config.storyDirectionPrompt}`
    : config.arcDirectionPrompt
    ? `\nNORTH STAR DIRECTION (always steer the narrative toward this): ${config.arcDirectionPrompt}`
    : '';

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

  // Thread maturity clause — tell LLM which threads are ripe for payoff
  const maturityClause = buildThreadMaturityClause(narrative, scenes, corner.forces.stakes > 0);

  // Knowledge asymmetry clause — tell LLM about dramatic information gaps
  const asymmetryClause = buildKnowledgeAsymmetryClause(narrative, scenes, corner.forces.variety > 0 || corner.forces.stakes > 0);

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

  return `${cornerDirectives[action]}${maturityClause}${asymmetryClause}${worldBuildSeed}${objectiveClause}${toneClause}${constraintClause}${directionClause}`;
}

/** Build a clause listing threads that are mature and primed for resolution */
function buildThreadMaturityClause(
  narrative: NarrativeState,
  scenes: Scene[],
  isHighStakesCorner: boolean,
): string {
  if (!isHighStakesCorner) return '';
  const maturityScores = computeThreadMaturity(narrative, scenes);
  const primed = maturityScores.filter(
    (m) => m.score >= 0.6 && PRIMED_SET.has(m.thread.status.toLowerCase()),
  );
  if (primed.length === 0) return '';

  const lines = primed.slice(0, 3).map((m) => {
    const anchors = m.thread.anchors
      .map((a) => a.type === 'character' ? narrative.characters[a.id]?.name : narrative.locations[a.id]?.name)
      .filter(Boolean)
      .join(', ');
    return `- "${m.thread.description}" [${m.thread.status}, maturity: ${(m.score * 100).toFixed(0)}%] — anchored to: ${anchors || 'unknown'}`;
  });
  return `\nTHREAD RESOLUTION PRIORITY — these threads have been building for a long time and are narratively ripe. Write scenes that bring them to a decisive conclusion. Use threadMutations to transition them to a terminal status ("resolved", "done", "subverted", "closed", or "abandoned"):\n${lines.join('\n')}`;
}

/** Build a clause surfacing dramatic knowledge gaps between characters */
function buildKnowledgeAsymmetryClause(
  narrative: NarrativeState,
  scenes: Scene[],
  isRelevantCorner: boolean,
): string {
  if (!isRelevantCorner) return '';
  const opportunities = analyzeKnowledgeAsymmetries(narrative, scenes);
  const top = opportunities.filter((o) => o.dramaticWeight > 0.3).slice(0, 3);
  if (top.length === 0) return '';

  const lines = top.map(
    (o) => `- ${o.holderName} knows "${o.content}" but ${o.ignorantName} does not — write a scene where this gap drives conflict, confrontation, or revelation`,
  );
  return `\nKNOWLEDGE ASYMMETRIES — these information gaps create dramatic opportunities. Use them to generate scenes where characters discover hidden truths, confront deceptions, or act on incomplete information:\n${lines.join('\n')}`;
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
