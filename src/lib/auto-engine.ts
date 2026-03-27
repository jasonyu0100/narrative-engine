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
import { detectCubeCorner, computeWindowedForces, averageSwing, FORCE_WINDOW_SIZE, forceDistance } from '@/lib/narrative-utils';
import { AUTO_STOP_CYCLE_LENGTH } from '@/lib/constants';

// ── Thread status helpers (derived from canonical lists in narrative.ts) ─────
const TERMINAL_SET = new Set<string>(THREAD_TERMINAL_STATUSES);
const ACTIVE_SET = new Set<string>(THREAD_ACTIVE_STATUSES.filter((s) => s !== 'dormant'));
const PRIMED_SET = new Set<string>(THREAD_PRIMED_STATUSES);

const FORCE_KEYS = ['payoff', 'change', 'knowledge'] as const;

function isTerminal(status: string): boolean {
  return TERMINAL_SET.has(status.toLowerCase());
}

function isActive(status: string): boolean {
  return ACTIVE_SET.has(status.toLowerCase());
}

// ── Objective multipliers for cube corners ──────────────────────────────────
// Bias action selection toward the high-level goal.
// High-payoff corners (H__) tend toward payoff/climax.
// Low-payoff corners (L__) tend toward exploration/open-endedness.
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

    // Anchor involvement in recent scenes
    const recentScenes = scenes.slice(-FORCE_WINDOW_SIZE);
    const anchorIds = new Set(thread.participants.map((a) => a.id));
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
  const charContinuityNodes = new Map<string, { content: string; index: number }[]>();
  for (const c of characters) {
    const contentSet = new Set(c.continuity.nodes.map((n) => n.content));
    charKnowledge.set(c.id, contentSet);
    charContinuityNodes.set(c.id, c.continuity.nodes.map((n, i) => ({ content: n.content, index: i })));
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
  return f.payoff * 0.4 + f.change * 0.3 + f.knowledge * 0.3;
}

// ── Story trajectory ────────────────────────────────────────────────────────
// Maps story progress (0–1) to a dramatic phase that shapes corner selection.
// The key insight: human-written stories have SHAPE — they breathe, with payoff
// and change oscillating across the zero line. Knowledge naturally declines as
// the story narrows focus, but payoff and change MUST dip into negative
// territory regularly to create contrast and quiet moments.

export type StoryPhase = 'setup' | 'rising' | 'midpoint' | 'escalation' | 'climax' | 'resolution';

type PhaseDefinition = {
  name: StoryPhase;
  range: [number, number];
  description: string;
  /** Scoring boost per corner — positive boosts, negative penalizes */
  cornerBias: Partial<Record<CubeCornerKey, number>>;
};

const STORY_PHASES: PhaseDefinition[] = [
  {
    name: 'setup',
    range: [0, 0.15],
    description: 'Establishing the world and characters. Payoff should be low, change moderate, knowledge high. Plant seeds — do not harvest them.',
    cornerBias: {
      LHH: 0.35, LLH: 0.3, LHL: 0.2, LLL: 0.1,  // exploration, discovery, routine
      HHH: -0.35, HHL: -0.3, HLH: -0.15,          // way too early for crisis
    },
  },
  {
    name: 'rising',
    range: [0.15, 0.35],
    description: 'Complications emerge and payoff begins to rise, but the story still breathes. Alternate tension-building scenes with quieter character moments. Payoff should cross zero — some high, some low.',
    cornerBias: {
      HLH: 0.2, LHH: 0.15, HLL: 0.15, LHL: 0.1, LLL: 0.1,  // slow burn + exploration + breathers
      HHH: -0.25, HHL: -0.1,                                   // don't peak yet
    },
  },
  {
    name: 'midpoint',
    range: [0.35, 0.50],
    description: 'A significant shift — a revelation, betrayal, or escalation that redefines the conflict. One intense arc, then pull back to absorb the impact. Payoff and change should spike then dip.',
    cornerBias: {
      HHL: 0.25, HLH: 0.15, LLL: 0.1,  // climactic moment then tension + recovery
      LLH: -0.1,                          // shouldn't wander aimlessly
    },
  },
  {
    name: 'escalation',
    range: [0.50, 0.75],
    description: 'Building toward the climax. Payoff trends upward but MUST still include valleys — quiet scenes between intense ones. Change should alternate between bursts and pauses.',
    cornerBias: {
      HHL: 0.2, HLH: 0.2, HHH: 0.1, LLL: 0.1, HLL: 0.1,  // tension building + mandatory breathers
      LLH: -0.15,                                             // less wandering
    },
  },
  {
    name: 'climax',
    range: [0.75, 0.90],
    description: 'Peak intensity — the story\'s most consequential moments. Even here, include at least one quiet scene between high-intensity arcs for contrast. Without valleys, peaks have no impact.',
    cornerBias: {
      HHH: 0.3, HHL: 0.3, HLH: 0.15,   // maximum intensity
      LLL: 0.05,                           // even climax needs a breath
      LLH: -0.25, LHL: -0.15,             // less routine exploration
    },
  },
  {
    name: 'resolution',
    range: [0.90, 1.0],
    description: 'Wind down and resolve remaining threads. Payoff and change should drop — the storm has passed. Focus on aftermath, character growth, and closure.',
    cornerBias: {
      LLL: 0.35, LLH: 0.2, LHL: 0.2, HLL: 0.1,   // recovery and resolution
      HHH: -0.35, HHL: -0.25, LHH: -0.1,           // don't restart intensity
    },
  },
];

/** Manual-stop mode cycles: every CYCLE_LENGTH arcs is one full dramatic "season" */
const MANUAL_STOP_CYCLE_LENGTH = AUTO_STOP_CYCLE_LENGTH;

/**
 * Compute story progress as 0–1 based on end conditions.
 * For multiple conditions, uses the one closest to completion.
 * For manual_stop, creates a repeating seasonal cycle.
 */
export function computeStoryProgress(
  narrative: NarrativeState,
  resolvedKeys: string[],
  config: AutoConfig,
  startingSceneCount: number,
  startingArcCount: number,
): number {
  const hasManualOnly = config.endConditions.length === 1 && config.endConditions[0].type === 'manual_stop';

  if (hasManualOnly || config.endConditions.length === 0) {
    // Repeating seasonal cycle for open-ended stories
    const arcCount = Object.keys(narrative.arcs).length - startingArcCount;
    return (arcCount % MANUAL_STOP_CYCLE_LENGTH) / MANUAL_STOP_CYCLE_LENGTH;
  }

  let maxProgress = 0;
  for (const cond of config.endConditions) {
    let progress = 0;
    switch (cond.type) {
      case 'scene_count': {
        const scenesThisRun = resolvedKeys.length - startingSceneCount;
        progress = Math.min(1, scenesThisRun / Math.max(cond.target, 1));
        break;
      }
      case 'arc_count': {
        const arcsThisRun = Object.keys(narrative.arcs).length - startingArcCount;
        progress = Math.min(1, arcsThisRun / Math.max(cond.target, 1));
        break;
      }
    }
    maxProgress = Math.max(maxProgress, progress);
  }
  return maxProgress;
}

/** Get the current story phase based on progress */
export function getStoryPhase(progress: number): PhaseDefinition {
  for (const phase of STORY_PHASES) {
    if (progress >= phase.range[0] && progress < phase.range[1]) return phase;
  }
  return STORY_PHASES[STORY_PHASES.length - 1]; // resolution
}

// ── Check end conditions ────────────────────────────────────────────────────
export function checkEndConditions(
  narrative: NarrativeState,
  resolvedKeys: string[],
  config: AutoConfig,
  startingSceneCount = 0,
  startingArcCount = 0,
  activeBranchId?: string,
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
      case 'planning_complete': {
        // Check if the ACTIVE branch's planning queue is fully completed
        const activeBranch = activeBranchId ? narrative.branches[activeBranchId] : undefined;
        const pq = activeBranch?.planningQueue;
        if (pq) {
          const allDone = pq.phases.every((p) => p.status === 'completed');
          if (allDone) return cond;
        }
        break;
      }
      case 'manual_stop':
        break; // only triggered by user
    }
  }
  return null;
}

// World building is now driven exclusively by the planning queue.
// When a planning phase completes, the transition pipeline triggers
// world expansion before generating direction/constraints for the next phase.

// ── Per-force saturation detection ───────────────────────────────────────────
// Detects when individual forces are pinned at extremes, which composite
// metrics like avgTension mask (e.g. payoff=1 + knowledge=-1 = "moderate").
type ForceSaturation = { saturated: boolean; direction: number };

function detectForceSaturation(
  scenes: Scene[],
  forceMap: Record<string, ForceSnapshot>,
): Record<'payoff' | 'change' | 'knowledge', ForceSaturation> {
  const result: Record<'payoff' | 'change' | 'knowledge', ForceSaturation> = {
    payoff: { saturated: false, direction: 0 },
    change: { saturated: false, direction: 0 },
    knowledge: { saturated: false, direction: 0 },
  };
  const window = scenes.slice(-FORCE_WINDOW_SIZE);
  if (window.length < 4) return result;

  for (const key of FORCE_KEYS) {
    const values = window.map((s) => forceMap[s.id]?.[key] ?? 0);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const range = Math.max(...values) - Math.min(...values);
    const allHigh = values.every((v) => v > 0.7);
    const allLow = values.every((v) => v < -0.7);
    const stagnant = range < 0.15 && window.length >= 5;

    if (allHigh) {
      result[key] = { saturated: true, direction: 1 };
    } else if (allLow) {
      result[key] = { saturated: true, direction: -1 };
    } else if (stagnant && (avg > 0.5 || avg < -0.5)) {
      result[key] = { saturated: true, direction: avg > 0 ? 1 : -1 };
    }
  }
  return result;
}

// ── Corner selection history tracking ────────────────────────────────────────
// Detect repetitive corner picks from the auto run log stored in arc metadata.
function detectCornerRepetition(
  scenes: Scene[],
  forceMap: Record<string, ForceSnapshot>,
): Record<CubeCornerKey, number> {
  const recentCorners: CubeCornerKey[] = [];
  const recentScenes = scenes.slice(-FORCE_WINDOW_SIZE * 2);

  // Infer corners from force snapshots of arc-ending scenes
  const arcLastScene = new Map<string, Scene>();
  for (const s of recentScenes) {
    arcLastScene.set(s.arcId, s);
  }
  for (const s of arcLastScene.values()) {
    const f = forceMap[s.id];
    if (f) recentCorners.push(detectCubeCorner(f).key as CubeCornerKey);
  }

  // Count occurrences of each corner in the last N arcs
  const counts: Record<string, number> = {};
  for (const c of recentCorners.slice(-FORCE_WINDOW_SIZE)) {
    counts[c] = (counts[c] ?? 0) + 1;
  }
  return counts as Record<CubeCornerKey, number>;
}

// ── Decision engine ─────────────────────────────────────────────────────────
// Scores all 8 cube corners as possible narrative directions.
// Architecture: two-phase scoring.
//   Phase 1: Hard constraints — eliminate corners that push saturated forces further.
//   Phase 2: Soft signals — score remaining corners by narrative needs.
// This prevents soft signals from outvoting balance corrections.
export function evaluateNarrativeState(
  narrative: NarrativeState,
  resolvedKeys: string[],
  _currentIndex: number,
  config: AutoConfig,
  startingSceneCount = 0,
  startingArcCount = 0,
): { weights: AutoActionWeight[]; directiveCtx: DirectiveContext } {
  const scenes = resolvedKeys.map((k) => narrative.scenes[k]).filter(Boolean).filter(isScene) as Scene[];
  const threads = Object.values(narrative.threads);
  const characters = Object.values(narrative.characters);
  // Neutral multipliers — direction and constraints guide the narrative instead of objectives
  const objectiveMult = OBJECTIVE_MULTIPLIERS.explore_and_resolve;

  // ── Story trajectory ──────────────────────────────────────────────────
  const storyProgress = computeStoryProgress(narrative, resolvedKeys, config, startingSceneCount, startingArcCount);
  const storyPhase = getStoryPhase(storyProgress);

  // ── Current force state (windowed — relative to recent scenes) ──────────
  const windowed = computeWindowedForces(scenes, scenes.length - 1);
  const forceMap = windowed.forceMap;
  const lastScene = scenes[scenes.length - 1];
  const currentForce = (lastScene ? forceMap[lastScene.id] : null) ?? { payoff: 0, change: 0, knowledge: 0 };
  const currentCorner = detectCubeCorner(currentForce);

  // ── Swing analysis ────────────────────────────────────────────────────────
  const recentForceSnapshots = scenes.slice(-FORCE_WINDOW_SIZE).map((s) => forceMap[s.id] ?? { payoff: 0, change: 0, knowledge: 0 });
  const recentSwing = averageSwing(recentForceSnapshots, FORCE_WINDOW_SIZE);

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

  // ── Character coverage ──────────────────────────────────────────────────
  const anchorCharacters = characters.filter((c) => c.role === 'anchor');
  const recentSceneWindow = scenes.slice(-config.minScenesBetweenCharacterFocus);
  const recentParticipants = new Set(recentSceneWindow.flatMap((s) => s.participantIds));
  const neglectedAnchors = config.characterRotationEnabled
    ? anchorCharacters.filter((c) => !recentParticipants.has(c.id))
    : [];

  // ── Post-climax detection ─────────────────────────────────────────────
  const recentWindow = scenes.slice(-FORCE_WINDOW_SIZE);
  const recentForces = recentWindow.map((s) => forceMap[s.id] ?? { payoff: 0, change: 0, knowledge: 0 });
  const isPostClimax = recentForces.length >= 3 &&
    compositeTension(recentForces[0]) > 0.75 &&
    compositeTension(recentForces[recentForces.length - 1]) - compositeTension(recentForces[0]) < -0.15;

  // ── Thread maturity (primed for resolution) ───────────────────────────
  const maturityScores = computeThreadMaturity(narrative, scenes);
  const primedThreads = maturityScores.filter(
    (m) => m.score >= 0.6 && PRIMED_SET.has(m.thread.status.toLowerCase()),
  );

  // ── Knowledge asymmetries ────────────────────────────────────────────
  const continuityOpportunities = analyzeKnowledgeAsymmetries(narrative, scenes);
  const hasHighDramaOpportunities = continuityOpportunities.length > 0 && continuityOpportunities[0].dramaticWeight > 0.4;

  // ── PHASE 1: Hard constraints — force saturation & corner repetition ──
  const forceSaturation = detectForceSaturation(scenes, forceMap);
  const saturatedForces = FORCE_KEYS.filter((k) => forceSaturation[k].saturated);
  const cornerRepetition = detectCornerRepetition(scenes, forceMap);

  // Build eligible set: eliminate corners that push ALL saturated forces deeper
  const ALL_CORNERS: CubeCornerKey[] = ['HHH', 'HHL', 'HLH', 'HLL', 'LHH', 'LHL', 'LLH', 'LLL'];
  const eligibleCorners = new Set<CubeCornerKey>(ALL_CORNERS);

  if (saturatedForces.length > 0) {
    for (const key of ALL_CORNERS) {
      const corner = NARRATIVE_CUBE[key];
      // Count how many saturated forces this corner pushes in the wrong direction
      let wrongDirection = 0;
      let rightDirection = 0;
      for (const fk of saturatedForces) {
        const cornerSign = corner.forces[fk] > 0 ? 1 : -1;
        if (cornerSign === forceSaturation[fk].direction) wrongDirection++;
        else rightDirection++;
      }
      // Eliminate if it corrects ZERO saturated forces (all wrong or neutral)
      if (wrongDirection > 0 && rightDirection === 0) {
        eligibleCorners.delete(key);
      }
    }
    // Safety: never eliminate all corners
    if (eligibleCorners.size === 0) {
      for (const key of ALL_CORNERS) eligibleCorners.add(key);
    }
  }

  // ── PHASE 2: Score eligible corners ───────────────────────────────────
  const scores: AutoActionWeight[] = [];

  for (const key of ALL_CORNERS) {
    const corner = NARRATIVE_CUBE[key];
    const isHighPayoff = corner.forces.payoff > 0;
    const isHighChange = corner.forces.change > 0;
    const isLowChange = corner.forces.change < 0;
    const isHighKnowledge = corner.forces.knowledge > 0;

    // Eliminated corners get a floor score — they can only win if nothing else works
    if (!eligibleCorners.has(key)) {
      scores.push({
        action: key,
        score: 0.05,
        reason: `eliminated: pushes saturated force(s) ${saturatedForces.join(', ')} further`,
      });
      continue;
    }

    let score = 0.5;
    const reasons: string[] = [];

    // ── 1. Distance from current state ──────────────────────────────────
    const dist = forceDistance(currentForce, corner.forces);
    if (dist < 0.3) {
      score -= 0.2;
      reasons.push('too close to current state');
    } else if (dist > 0.5 && dist < 2.0) {
      score += 0.15;
    }

    // ── 2. Avoid current corner + penalize repetition ───────────────────
    if (key === currentCorner.key) {
      score -= 0.3;
      reasons.push('already in this corner');
    }
    const recentCount = cornerRepetition[key] ?? 0;
    if (recentCount >= 2) {
      score -= 0.15 * (recentCount - 1);
      reasons.push(`picked ${recentCount}x in recent arcs — needs knowledge`);
    }

    // ── 3. Thread-driven signals ────────────────────────────────────────
    // These are now GATED by saturation: thread signals that push in the
    // same direction as a saturated force are suppressed.
    const payoffNotSaturatedHigh = !forceSaturation.payoff.saturated || forceSaturation.payoff.direction !== 1;
    const changeNotSaturatedLow = !forceSaturation.change.saturated || forceSaturation.change.direction !== -1;

    // Too many active threads → favor resolution, but NOT if payoff already saturated high
    if (activeThreads.length > config.maxActiveThreads && isHighPayoff && payoffNotSaturatedHigh) {
      score += 0.2;
      reasons.push(`${activeThreads.length} active threads need resolution`);
    } else if (activeThreads.length > config.maxActiveThreads && isHighChange) {
      // Redirect thread pressure to change instead when payoff is saturated
      score += 0.15;
      reasons.push(`${activeThreads.length} active threads — change can advance them`);
    }

    // Stagnant threads → change, but gate if change is already saturated low
    if (stagnantThreads.length > 0 && isHighChange && changeNotSaturatedLow) {
      score += 0.15;
      reasons.push(`${stagnantThreads.length} stagnant threads need movement`);
    }

    // Dormant threads → knowledge
    if (dormantThreads.length > 2 && isHighKnowledge) {
      score += 0.1;
      reasons.push(`${dormantThreads.length} dormant threads — knowledge can surface them`);
    }

    // Primed threads → resolution, gated by payoff saturation
    if (primedThreads.length > 0 && isHighPayoff && payoffNotSaturatedHigh) {
      const boost = Math.min(0.35, primedThreads.length * 0.12);
      score += boost;
      reasons.push(`${primedThreads.length} thread(s) primed for resolution`);
    } else if (primedThreads.length > 0 && isHighChange) {
      // Can still resolve through change-driven payoff
      score += 0.1;
      reasons.push(`${primedThreads.length} primed thread(s) — change can deliver payoff`);
    }

    // Knowledge asymmetries → revelation, favor knowledge over payoff when payoff saturated
    if (hasHighDramaOpportunities) {
      if (isHighKnowledge) {
        score += 0.2;
        reasons.push('knowledge asymmetries — knowledge creates revelation opportunities');
      } else if (isHighPayoff && payoffNotSaturatedHigh) {
        score += 0.15;
        reasons.push('knowledge asymmetries — payoff can force confrontation');
      }
    }

    // ── 4. Per-force tension management (replaces composite tension) ────
    // Use individual force values, not composite, to avoid masking
    for (const fk of FORCE_KEYS) {
      const sat = forceSaturation[fk];
      if (!sat.saturated) continue;

      const cornerSign = corner.forces[fk] > 0 ? 1 : -1;
      if (cornerSign !== sat.direction) {
        // Corner corrects this saturated force
        score += 0.25;
        reasons.push(`corrects ${fk} (saturated ${sat.direction > 0 ? 'high' : 'low'})`);
      }
    }

    // ── 5. Post-climax: strongly favor recovery corners ─────────────────
    if (isPostClimax) {
      if (key === 'LLL' || key === 'LLH' || key === 'LHL') {
        score += 0.4;
        reasons.push('post-climax recovery');
      } else if (isHighPayoff && isHighChange) {
        score *= 0.2;
        reasons.push('suppressed post-climax');
      }
    }

    // ── 6. Neglected characters ─────────────────────────────────────────
    if (neglectedAnchors.length > 0 && isLowChange) {
      score += 0.1;
      reasons.push(`${neglectedAnchors.length} neglected anchors — good for character focus`);
    }

    // ── 7. Story trajectory — phase-based corner shaping ────────────────
    // This is what gives the story macro-shape: setup → rising → midpoint
    // → escalation → climax → resolution. Without it, every arc is
    // selected independently and the story has no dramatic arc.
    const phaseBias = storyPhase.cornerBias[key] ?? 0;
    if (phaseBias !== 0) {
      score += phaseBias;
      reasons.push(`${storyPhase.name} phase (${Math.round(storyProgress * 100)}%)`);
    }

    // ── 8. Swing vibrancy ─────────────────────────────────────────────
    // Low swing means the story has been flat — boost corners that contrast
    // the current state to create dynamic scene-to-scene shifts
    if (recentSwing < 0.3 && dist > 1.0) {
      score += 0.2;
      reasons.push('low balance — favoring high-contrast corner for vibrancy');
    } else if (recentSwing < 0.5 && dist > 0.8) {
      score += 0.1;
      reasons.push('moderate balance — slight contrast boost');
    }

    // ── 9. Apply objective multiplier ───────────────────────────────────
    // Dampened when saturation is active — objective shouldn't override balance
    const dampening = saturatedForces.length > 0 ? 0.5 : 1.0;
    const mult = 1 + (objectiveMult[key] - 1) * dampening;
    score *= mult;

    scores.push({
      action: key,
      score: Math.max(0, Math.min(1, score)),
      reason: reasons.join('; ') || corner.name,
    });
  }

  return {
    weights: scores.sort((a, b) => b.score - a.score),
    directiveCtx: {
      scenes,
      stagnantThreads,
      primedThreads,
      continuityOpportunities,
      forceSaturation,
      recentSwing,
      storyProgress,
      storyPhase,
    },
  };
}

/** Pick the scene count for an auto-generated arc based on the target cube corner */
export function pickArcLength(config: AutoConfig, action: AutoAction): number {
  const corner = NARRATIVE_CUBE[action];
  const f = corner.forces;

  // High change → longer arcs (more scenes to carry the pace)
  // Low change → shorter arcs (brief, contemplative)
  // High payoff → medium-long (need scenes to build/release payoff)
  if (f.change > 0 && f.payoff > 0) {
    // High energy corners (HHH, HHL) — full arcs
    return config.maxArcLength;
  } else if (f.change < 0 && f.payoff < 0) {
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

/** Pre-computed analysis passed from evaluateNarrativeState to buildActionDirective */
export type DirectiveContext = {
  scenes: Scene[];
  stagnantThreads: Thread[];
  primedThreads: ThreadMaturity[];
  continuityOpportunities: KnowledgeOpportunity[];
  forceSaturation: Record<'payoff' | 'change' | 'knowledge', ForceSaturation>;
  recentSwing: number;
  storyProgress: number;
  storyPhase: { name: StoryPhase; description: string };
};

/** Build the action-specific direction hint injected into AI prompts */
export function buildActionDirective(
  action: AutoAction,
  narrative: NarrativeState,
  config: AutoConfig,
  ctx: DirectiveContext,
): string {
  const corner = NARRATIVE_CUBE[action];

  const toneClause = config.toneGuidance ? `\nTone: ${config.toneGuidance}` : '';
  const constraintClause = config.narrativeConstraints ? `\nConstraints: ${config.narrativeConstraints}` : '';
  const directionClause = config.northStarPrompt
    ? `\nSTORY DIRECTION (steer the narrative toward this): ${config.northStarPrompt}`
    : '';

  // Direction and constraints are the primary guidance — no objective clause needed

  // World build seed clause
  const worldBuildSeed = buildWorldBuildSeedClause(narrative, ctx.scenes);

  // Thread context for relevant corners
  const threadContext = ctx.stagnantThreads.length > 0
    ? `\nStagnant threads needing attention: ${ctx.stagnantThreads.map((t) => t.description).join(', ')}.`
    : '';

  // Thread maturity clause
  const maturityClause = buildThreadMaturityClause(narrative, ctx.primedThreads, corner.forces.payoff > 0);

  // Knowledge asymmetry clause
  const asymmetryClause = buildKnowledgeAsymmetryClause(ctx.continuityOpportunities, corner.forces.knowledge > 0 || corner.forces.payoff > 0);

  // Force balance clause — uses pre-computed saturation
  const balanceClause = buildForceBalanceClause(ctx.forceSaturation);

  // Swing vibrancy clause
  const vibrancyClause = buildSwingClause(ctx.recentSwing);

  // Story trajectory clause
  const trajectoryClause = `\nSTORY TRAJECTORY: You are at ${Math.round(ctx.storyProgress * 100)}% of the story — phase: ${ctx.storyPhase.name.toUpperCase()}. ${ctx.storyPhase.description}`;

  // Corner-specific directives
  const cornerDirectives: Record<CubeCornerKey, string> = {
    HHH: `CONVERGENCE — ${corner.description} Push all forces to maximum. Multiple threads should collide simultaneously. This is the most intense, chaotic moment of the narrative. Pack scenes with consequences — thread escalations, secrets revealed under pressure, alliances shattering. Characters are learning and changing rapidly.${threadContext}`,
    HHL: `CLIMAX — ${corner.description} Drive toward a decisive payoff. High stakes and rapid pace, but the situation is clear and focused. This is the moment of maximum reader investment. Threads should advance decisively, characters face truths they can't unsee, relationships are tested to breaking point.${threadContext}`,
    HLH: `TWIST — ${corner.description} A revelation or twist that pays off threads but characters haven't caught up yet. New elements reshape the landscape before anyone can react. Shocking discoveries, unexpected faces, unfamiliar ground. Use new/rare locations and characters.${threadContext}`,
    HLL: `CLOSURE — ${corner.description} Threads wrap up quietly among familiar faces. Tying loose ends, resolving what was left hanging. The aftermath of climactic events. Characters reflect on what happened, relationships settle into new configurations, threads reach terminal statuses.${threadContext}`,
    LHH: `DISCOVERY — ${corner.description} Characters grow and change while exploring new territory. No payoffs yet but high energy and surprise. World-building, early adventure, open possibility space. Characters discover new places, form first impressions, and build alliances. Use new locations and underused characters.`,
    LHL: `GROWTH — ${corner.description} Characters develop among familiar faces without plot advancement. Training, bonding, processing events. Internal change without external payoff. Personal insights, skills learned, trust deepening, rivalries softening.`,
    LLH: `WANDERING — ${corner.description} Contemplative and transitional. Characters in unfamiliar conditions without clear direction. Plant seeds, explore the unknown quietly. Observations, memories surfacing, subtle shifts in how characters see each other. Use new/rare locations.`,
    LLL: `REST — ${corner.description} Breathing room after intensity. Focus on recovery, character relationships, and subtle foreshadowing. Plant seeds for future conflict. Quiet realizations, overheard details, gentle relationship shifts.`,
  };

  return `${cornerDirectives[action]}${trajectoryClause}${vibrancyClause}${balanceClause}${maturityClause}${asymmetryClause}${worldBuildSeed}${toneClause}${constraintClause}${directionClause}`;
}

/** Build LLM correction text from pre-computed saturation results */
function buildForceBalanceClause(
  saturation: Record<'payoff' | 'change' | 'knowledge', ForceSaturation>,
): string {
  const HIGH_CORRECTIONS: Record<string, string> = {
    payoff: 'Payoff has been at maximum for too long. Write scenes where immediate danger recedes — characters regroup, reflect, or shift focus to personal/interpersonal matters rather than existential threats. Use low-payoff thread mutations.',
    change: 'Change has been relentlessly fast. Slow down — write contemplative, dialogue-heavy scenes. Let characters process events instead of rushing to the next plot point.',
    knowledge: 'Knowledge has been too high for too long. Ground the narrative — return to familiar locations and established character dynamics instead of constantly introducing new elements.',
  };
  const LOW_CORRECTIONS: Record<string, string> = {
    payoff: 'Payoff has been too low for too long. Introduce genuine consequences — a betrayal, a threat, a revelation that changes everything. Characters should face real risk.',
    change: 'Change has stagnated. Inject urgency — time pressure, pursuit, rapid developments. Move characters into action instead of contemplation.',
    knowledge: 'Knowledge has collapsed — the story feels repetitive. Shift perspective, introduce an unexpected character, change location, or subvert an established pattern. Break the routine.',
  };

  const corrections: string[] = [];
  for (const key of FORCE_KEYS) {
    const sat = saturation[key];
    if (!sat.saturated) continue;
    corrections.push(sat.direction > 0 ? HIGH_CORRECTIONS[key] : LOW_CORRECTIONS[key]);
  }

  if (corrections.length === 0) return '';
  return `\nFORCE BALANCE CORRECTION — the narrative has become unbalanced. You MUST address these issues in the scenes you generate:\n${corrections.map((c) => `- ${c}`).join('\n')}`;
}

/** Build a clause about swing vibrancy — high swing = vibrant story, low swing = flat */
function buildSwingClause(recentSwing: number): string {
  if (recentSwing < 0.3) {
    return '\nBALANCE VIBRANCY — WARNING: The story has become flat. Recent scenes feel samey in energy. You MUST create dramatic contrast between scenes — alternate between high-intensity and quiet moments. Each scene should feel dynamically different from the one before. A vibrant narrative never stays at the same energy level.';
  }
  if (recentSwing < 0.6) {
    return '\nBALANCE VIBRANCY — The story could use more dynamic range. Vary the energy between scenes — follow an intense scene with a contemplative one, or a quiet buildup with a sudden escalation. Readers thrive on contrast.';
  }
  if (recentSwing > 1.5) {
    return '\nBALANCE VIBRANCY — Excellent dynamic range. The story feels alive with constant shifts between high and low energy. Maintain this rhythm — keep alternating between different force levels to sustain the vibrant, unpredictable feel.';
  }
  return '';
}

/** Build a clause listing threads that are mature and primed for resolution */
function buildThreadMaturityClause(
  narrative: NarrativeState,
  primedThreads: ThreadMaturity[],
  isHighPayoffCorner: boolean,
): string {
  if (!isHighPayoffCorner || primedThreads.length === 0) return '';


  const lines = primedThreads.slice(0, 3).map((m) => {
    const participants = m.thread.participants
      .map((a) => a.type === 'character' ? narrative.characters[a.id]?.name : narrative.locations[a.id]?.name)
      .filter(Boolean)
      .join(', ');
    return `- "${m.thread.description}" [${m.thread.status}, maturity: ${(m.score * 100).toFixed(0)}%] — participants: ${participants || 'unknown'}`;
  });
  return `\nTHREAD RESOLUTION PRIORITY — these threads have been building for a long time and are narratively ripe. Write scenes that bring them to a decisive conclusion. Use threadMutations to transition them to a terminal status ("resolved", "subverted", or "abandoned"):\n${lines.join('\n')}`;
}

/** Build a clause surfacing dramatic knowledge gaps between characters */
function buildKnowledgeAsymmetryClause(
  opportunities: KnowledgeOpportunity[],
  isRelevantCorner: boolean,
): string {
  if (!isRelevantCorner) return '';
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
  scenes: Scene[],
): string {
  const worldBuilds = Object.values(narrative.worldBuilds);
  if (worldBuilds.length === 0) return '';

  const usedCharIds = new Set(scenes.flatMap((s) => s.participantIds));
  const usedLocIds = new Set(scenes.map((s) => s.locationId));
  const mutatedThreadIds = new Set(scenes.flatMap((s) => s.threadMutations.map((tm) => tm.threadId)));

  const unusedChars: string[] = [];
  const unusedLocs: string[] = [];
  const unusedThreads: string[] = [];

  for (const wb of worldBuilds) {
    for (const c of wb.expansionManifest.characters) {
      if (!usedCharIds.has(c.id)) {
        const live = narrative.characters[c.id];
        unusedChars.push(`${live?.name ?? c.name} (${live?.role ?? c.role})`);
      }
    }
    for (const l of wb.expansionManifest.locations) {
      if (!usedLocIds.has(l.id)) {
        const live = narrative.locations[l.id];
        unusedLocs.push(live?.name ?? l.name);
      }
    }
    for (const t of wb.expansionManifest.threads) {
      if (!mutatedThreadIds.has(t.id)) {
        const live = narrative.threads[t.id];
        unusedThreads.push(live?.description ?? t.description);
      }
    }
  }

  if (unusedChars.length === 0 && unusedLocs.length === 0 && unusedThreads.length === 0) return '';

  const parts: string[] = ['\nConsider incorporating these unused world-building elements:'];
  if (unusedChars.length > 0) parts.push(`- Characters: ${unusedChars.slice(0, 4).join(', ')}`);
  if (unusedLocs.length > 0) parts.push(`- Locations: ${unusedLocs.slice(0, 3).join(', ')}`);
  if (unusedThreads.length > 0) parts.push(`- Threads: ${unusedThreads.slice(0, 3).join(', ')}`);

  return parts.join('\n');
}
