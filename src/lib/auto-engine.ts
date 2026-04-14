import { AUTO_STOP_CYCLE_LENGTH } from "@/lib/constants";
import {
  computeForceSnapshots,
  FORCE_WINDOW_SIZE,
} from "@/lib/narrative-utils";
import { logInfo } from "@/lib/system-logger";
import type {
  AutoConfig,
  AutoEndCondition,
  Character,
  ForceSnapshot,
  NarrativeState,
  Scene,
  Thread,
} from "@/types/narrative";
import {
  isScene,
  THREAD_ACTIVE_STATUSES,
  THREAD_TERMINAL_STATUSES,
} from "@/types/narrative";

// ── Constants ────────────────────────────────────────────────────────────────

const TERMINAL_SET = new Set<string>(THREAD_TERMINAL_STATUSES);
const ACTIVE_STATUSES = new Set<string>(
  THREAD_ACTIVE_STATUSES.filter((s) => s !== "latent"),
);
const PRIMED_STATUSES = new Set<string>(["escalating", "critical"]);

/** Threads without delta for this many scenes are considered stale */
const STALE_THRESHOLD = 5;

/** Minimum continuity depth to consider an entity "developed" */
const DEVELOPED_THRESHOLD = 4;

/** Target active thread count - too many = chaos, too few = stagnant */
const IDEAL_ACTIVE_THREADS = { min: 2, max: 5 };

// ── Types ────────────────────────────────────────────────────────────────────

export type StoryPhase =
  | "setup"
  | "rising"
  | "midpoint"
  | "escalation"
  | "climax"
  | "resolution";

export type NarrativePressure = {
  /** Thread management pressure: stale threads, primed threads, density */
  threads: {
    stale: Thread[];
    primed: Thread[];
    activeCount: number;
    needsResolution: boolean;
    needsSeeding: boolean;
  };
  /** Entity development pressure: shallow characters, neglected anchors */
  entities: {
    shallow: Character[];
    neglected: Character[];
    recentGrowth: number;
  };
  /** System knowledge pressure: system growth rate */
  knowledge: {
    recentGrowth: number;
    isStagnant: boolean;
  };
  /** Overall balance */
  balance: {
    dominant: "fate" | "world" | "system" | "balanced";
    recommendation: string;
  };
};

export type AutoDirective = {
  phase: StoryPhase;
  progress: number;
  pressure: NarrativePressure;
  directive: string;
};

// ── Thread Analysis ──────────────────────────────────────────────────────────

function analyzeThreads(
  narrative: NarrativeState,
  scenes: Scene[],
): NarrativePressure["threads"] {
  const threads = Object.values(narrative.threads);
  const activeThreads = threads.filter((t) =>
    ACTIVE_STATUSES.has(t.status.toLowerCase()),
  );
  const primedThreads = threads.filter((t) =>
    PRIMED_STATUSES.has(t.status.toLowerCase()),
  );

  // Find stale threads (no delta in recent scenes)
  const lastTouch: Record<string, number> = {};
  scenes.forEach((scene, idx) => {
    for (const tm of scene.threadDeltas) {
      lastTouch[tm.threadId] = idx;
    }
  });

  const staleThreads = activeThreads.filter((t) => {
    const last = lastTouch[t.id] ?? -1;
    return scenes.length - 1 - last >= STALE_THRESHOLD;
  });

  return {
    stale: staleThreads,
    primed: primedThreads,
    activeCount: activeThreads.length,
    needsResolution: activeThreads.length > IDEAL_ACTIVE_THREADS.max,
    needsSeeding: activeThreads.length < IDEAL_ACTIVE_THREADS.min,
  };
}

// ── Entity Analysis ──────────────────────────────────────────────────────────

function analyzeEntities(
  narrative: NarrativeState,
  scenes: Scene[],
): NarrativePressure["entities"] {
  const characters = Object.values(narrative.characters);
  const anchors = characters.filter((c) => c.role === "anchor");

  // Find shallow characters (low continuity depth)
  const shallowChars = anchors.filter((c) => {
    const nodeCount = Object.keys(c.world.nodes).length;
    const edgeCount = c.world.edges.length;
    return nodeCount + Math.sqrt(edgeCount) < DEVELOPED_THRESHOLD;
  });

  // Find neglected anchors (not appearing in recent scenes)
  const recentScenes = scenes.slice(-FORCE_WINDOW_SIZE);
  const recentParticipants = new Set(
    recentScenes.flatMap((s) => s.participantIds),
  );
  const neglectedAnchors = anchors.filter(
    (c) => !recentParticipants.has(c.id),
  );

  // Calculate recent continuity growth
  const recentDeltas = recentScenes.flatMap((s) => s.worldDeltas);
  const recentGrowth = recentDeltas.reduce(
    (sum, m) => sum + m.addedNodes.length,
    0,
  );

  return {
    shallow: shallowChars,
    neglected: neglectedAnchors,
    recentGrowth,
  };
}

// ── Knowledge Analysis ───────────────────────────────────────────────────────

function analyzeKnowledge(
  narrative: NarrativeState,
  scenes: Scene[],
): NarrativePressure["knowledge"] {
  const recentScenes = scenes.slice(-FORCE_WINDOW_SIZE);

  // Calculate recent system growth from system deltas
  const recentGrowth = recentScenes.reduce((sum, s) => {
    const nodes = s.systemDeltas?.addedNodes?.length ?? 0;
    const edges = s.systemDeltas?.addedEdges?.length ?? 0;
    return sum + nodes + Math.sqrt(edges);
  }, 0);

  const avgGrowth = recentScenes.length > 0 ? recentGrowth / recentScenes.length : 0;

  return {
    recentGrowth,
    isStagnant: avgGrowth < 0.5,
  };
}

// ── Balance Analysis ─────────────────────────────────────────────────────────

function analyzeBalance(
  scenes: Scene[],
): NarrativePressure["balance"] {
  if (scenes.length < 3) {
    return { dominant: "balanced", recommendation: "Continue establishing the story." };
  }

  const forceMap = computeForceSnapshots(scenes);
  const recentScenes = scenes.slice(-FORCE_WINDOW_SIZE);
  const recentForces = recentScenes
    .map((s) => forceMap[s.id])
    .filter(Boolean) as ForceSnapshot[];

  if (recentForces.length === 0) {
    return { dominant: "balanced", recommendation: "Continue with current approach." };
  }

  // Average forces over recent window
  const avg = {
    fate: recentForces.reduce((s, f) => s + f.fate, 0) / recentForces.length,
    world: recentForces.reduce((s, f) => s + f.world, 0) / recentForces.length,
    system: recentForces.reduce((s, f) => s + f.system, 0) / recentForces.length,
  };

  // Find dominant force (if any is significantly higher)
  const max = Math.max(avg.fate, avg.world, avg.system);
  const min = Math.min(avg.fate, avg.world, avg.system);
  const spread = max - min;

  if (spread < 0.5) {
    return { dominant: "balanced", recommendation: "Good balance across all forces. Continue holistic storytelling." };
  }

  if (avg.fate === max) {
    return {
      dominant: "fate",
      recommendation: "Heavy on thread progression. Slow down — develop character inner worlds and ground the story in world details.",
    };
  }
  if (avg.world === max) {
    return {
      dominant: "world",
      recommendation: "Heavy on character development. Advance threads — create consequences and move toward resolution.",
    };
  }
  return {
    dominant: "system",
    recommendation: "Heavy on world-building. Ground it in character and story — use the rules to drive conflict, not just exposition.",
  };
}

// ── Story Phase ──────────────────────────────────────────────────────────────

const PHASE_RANGES: Record<StoryPhase, [number, number]> = {
  setup: [0, 0.15],
  rising: [0.15, 0.35],
  midpoint: [0.35, 0.5],
  escalation: [0.5, 0.75],
  climax: [0.75, 0.9],
  resolution: [0.9, 1.0],
};

const PHASE_GUIDANCE: Record<StoryPhase, string> = {
  setup: "Establish characters, world, and initial threads. Plant seeds — do not harvest them. Focus on world-building and character introduction.",
  rising: "Complications emerge. Threads should advance from seeded to active. Alternate tension with quieter character moments.",
  midpoint: "A significant shift — revelation, betrayal, or escalation. One thread should reach escalating or critical status.",
  escalation: "Building toward climax. Multiple threads should be escalating. Increase pressure but maintain breathing room.",
  climax: "Peak intensity. Resolve critical threads. Character inner worlds should pay off. Maximum convergence of all forces.",
  resolution: "Wind down. Resolve remaining threads. Focus on aftermath and character growth. Lower intensity.",
};

export function getStoryPhase(progress: number): StoryPhase {
  for (const [phase, [start, end]] of Object.entries(PHASE_RANGES) as [StoryPhase, [number, number]][]) {
    if (progress >= start && progress < end) return phase;
  }
  return "resolution";
}

// ── Progress Calculation ─────────────────────────────────────────────────────

export function computeStoryProgress(
  narrative: NarrativeState,
  resolvedKeys: string[],
  config: AutoConfig,
  startingSceneCount: number,
  startingArcCount: number,
): number {
  const hasManualOnly =
    config.endConditions.length === 1 &&
    config.endConditions[0].type === "manual_stop";

  if (hasManualOnly || config.endConditions.length === 0) {
    // Repeating seasonal cycle for open-ended stories
    const arcCount = Object.keys(narrative.arcs).length - startingArcCount;
    return (arcCount % AUTO_STOP_CYCLE_LENGTH) / AUTO_STOP_CYCLE_LENGTH;
  }

  let maxProgress = 0;
  for (const cond of config.endConditions) {
    let progress = 0;
    switch (cond.type) {
      case "scene_count": {
        const scenesThisRun = resolvedKeys.length - startingSceneCount;
        progress = Math.min(1, scenesThisRun / Math.max(cond.target, 1));
        break;
      }
      case "arc_count": {
        const arcsThisRun = Object.keys(narrative.arcs).length - startingArcCount;
        progress = Math.min(1, arcsThisRun / Math.max(cond.target, 1));
        break;
      }
    }
    maxProgress = Math.max(maxProgress, progress);
  }
  return maxProgress;
}

// ── End Condition Check ──────────────────────────────────────────────────────

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
      case "scene_count": {
        const scenesThisRun = resolvedKeys.length - startingSceneCount;
        if (scenesThisRun >= cond.target) {
          logInfo(`Auto-play end condition met: scene_count`, {
            source: "auto-play",
            operation: "check-end-conditions",
            details: { type: "scene_count", target: cond.target, scenesGenerated: scenesThisRun },
          });
          return cond;
        }
        break;
      }
      case "all_threads_resolved": {
        const threads = Object.values(narrative.threads);
        if (threads.length > 0 && threads.every((t) => TERMINAL_SET.has(t.status.toLowerCase()))) {
          logInfo(`Auto-play end condition met: all_threads_resolved`, {
            source: "auto-play",
            operation: "check-end-conditions",
            details: { type: "all_threads_resolved", threadCount: threads.length },
          });
          return cond;
        }
        break;
      }
      case "arc_count": {
        const arcsThisRun = Object.keys(narrative.arcs).length - startingArcCount;
        if (arcsThisRun >= cond.target) return cond;
        break;
      }
      case "planning_complete": {
        const activeBranch = activeBranchId ? narrative.branches[activeBranchId] : undefined;
        const coordPlan = activeBranch?.coordinationPlan;
        if (coordPlan && isPlanComplete(coordPlan)) {
          logInfo(`Auto-play end condition met: planning_complete`, {
            source: "auto-play",
            operation: "check-end-conditions",
            details: { type: "planning_complete", arcCount: coordPlan.plan.arcCount },
          });
          return cond;
        }
        break;
      }
      case "manual_stop":
        break;
    }
  }
  return null;
}

// ── Main Evaluation ──────────────────────────────────────────────────────────

export function evaluateNarrativeState(
  narrative: NarrativeState,
  resolvedKeys: string[],
  _currentIndex: number,
  config: AutoConfig,
  startingSceneCount = 0,
  startingArcCount = 0,
): AutoDirective {
  const scenes = resolvedKeys
    .map((k) => narrative.scenes[k])
    .filter(Boolean)
    .filter(isScene) as Scene[];

  // Compute progress and phase
  const progress = computeStoryProgress(
    narrative,
    resolvedKeys,
    config,
    startingSceneCount,
    startingArcCount,
  );
  const phase = getStoryPhase(progress);

  // Analyze all three dimensions
  const pressure: NarrativePressure = {
    threads: analyzeThreads(narrative, scenes),
    entities: analyzeEntities(narrative, scenes),
    knowledge: analyzeKnowledge(narrative, scenes),
    balance: analyzeBalance(scenes),
  };

  // Build directive
  const directive = buildDirective(narrative, config, phase, pressure);

  logInfo(`Auto-play evaluation complete`, {
    source: "auto-play",
    operation: "evaluate-narrative-state",
    details: {
      phase,
      progress: Math.round(progress * 100),
      activeThreads: pressure.threads.activeCount,
      staleThreads: pressure.threads.stale.length,
      primedThreads: pressure.threads.primed.length,
      shallowCharacters: pressure.entities.shallow.length,
      neglectedAnchors: pressure.entities.neglected.length,
      balance: pressure.balance.dominant,
    },
  });

  return { phase, progress, pressure, directive };
}

// ── Directive Builder ────────────────────────────────────────────────────────

function buildDirective(
  narrative: NarrativeState,
  config: AutoConfig,
  phase: StoryPhase,
  pressure: NarrativePressure,
): string {
  const sections: string[] = [];

  // 1. Story phase
  sections.push(`## Story Phase: ${phase.toUpperCase()} (${Math.round(pressure.balance.dominant === "balanced" ? 50 : 0)}% through arc)`);
  sections.push(PHASE_GUIDANCE[phase]);

  // 2. Thread management
  sections.push("\n## Thread Management");
  if (pressure.threads.primed.length > 0) {
    const primedList = pressure.threads.primed
      .slice(0, 3)
      .map((t) => `- "${t.description}" [${t.status}]`)
      .join("\n");
    sections.push(`PRIMED FOR RESOLUTION — these threads are ready for payoff:\n${primedList}`);
  }
  if (pressure.threads.stale.length > 0) {
    const staleList = pressure.threads.stale
      .slice(0, 3)
      .map((t) => `- "${t.description}" [${t.status}]`)
      .join("\n");
    sections.push(`STALE THREADS — need advancement or resolution:\n${staleList}`);
  }
  if (pressure.threads.needsResolution) {
    sections.push(`TOO MANY ACTIVE THREADS (${pressure.threads.activeCount}) — focus on resolution, not seeding new threads.`);
  }
  if (pressure.threads.needsSeeding) {
    sections.push(`TOO FEW ACTIVE THREADS (${pressure.threads.activeCount}) — seed or activate new threads.`);
  }

  // 3. Character development
  sections.push("\n## Character Inner Worlds");
  if (pressure.entities.shallow.length > 0) {
    const shallowList = pressure.entities.shallow
      .slice(0, 3)
      .map((c) => `- ${c.name}`)
      .join("\n");
    sections.push(`UNDERDEVELOPED CHARACTERS — need continuity depth (beliefs, traits, history, goals):\n${shallowList}`);
  }
  if (pressure.entities.neglected.length > 0) {
    const neglectedList = pressure.entities.neglected
      .slice(0, 3)
      .map((c) => `- ${c.name}`)
      .join("\n");
    sections.push(`NEGLECTED ANCHORS — haven't appeared recently:\n${neglectedList}`);
  }
  if (pressure.entities.recentGrowth < 2) {
    sections.push("LOW CHARACTER DEVELOPMENT — recent scenes lack world deltas. Deepen character inner worlds.");
  }

  // 4. System knowledge
  sections.push("\n## System Knowledge Pressure");
  if (pressure.knowledge.isStagnant) {
    sections.push("WORLD-BUILDING STAGNANT — introduce new rules, systems, or concepts. Expand what we know about how this world works.");
  }

  // 5. Balance recommendation
  sections.push("\n## Balance");
  sections.push(pressure.balance.recommendation);

  // 6. User-provided guidance
  if (config.direction) {
    sections.push(`\n## Direction\n${config.direction}`);
  }
  if (config.toneGuidance) {
    sections.push(`\n## Tone\n${config.toneGuidance}`);
  }
  if (config.narrativeConstraints) {
    sections.push(`\n## Constraints\n${config.narrativeConstraints}`);
  }

  return sections.join("\n");
}

// ── Arc Length Selection ─────────────────────────────────────────────────────

export function pickArcLength(config: AutoConfig, pressure: NarrativePressure): number {
  // Primed threads ready for resolution → shorter, focused arcs
  if (pressure.threads.primed.length >= 2) {
    return config.minArcLength;
  }
  // Too many active threads → medium arcs to manage complexity
  if (pressure.threads.needsResolution) {
    return Math.ceil((config.minArcLength + config.maxArcLength) / 2);
  }
  // Character development needed → longer arcs for breathing room
  if (pressure.entities.shallow.length > 0 || pressure.entities.recentGrowth < 2) {
    return config.maxArcLength;
  }
  // Default to medium
  return Math.ceil((config.minArcLength + config.maxArcLength) / 2);
}

// ── Legacy exports for compatibility ─────────────────────────────────────────

export type DirectiveContext = {
  scenes: Scene[];
  storyProgress: number;
  storyPhase: { name: StoryPhase; description: string };
};

export function buildOutlineDirective(
  narrative: NarrativeState,
  config: AutoConfig,
  ctx: DirectiveContext,
): string {
  const scenes = ctx.scenes;
  const pressure: NarrativePressure = {
    threads: analyzeThreads(narrative, scenes),
    entities: analyzeEntities(narrative, scenes),
    knowledge: analyzeKnowledge(narrative, scenes),
    balance: analyzeBalance(scenes),
  };
  return buildDirective(narrative, config, ctx.storyPhase.name, pressure);
}

// ── Coordination Plan Support ─────────────────────────────────────────────────

import type { ArcForceMode, BranchPlan, CoordinationNode, CoordinationPlan } from "@/types/narrative";

/**
 * Get the arc-anchor node for a specific arc index from the plan.
 * Exactly one peak OR valley per arc carries arcIndex and sceneCount.
 * Moments never anchor arcs.
 */
export function getArcNode(plan: CoordinationPlan, arcIndex: number): CoordinationNode | undefined {
  return plan.nodes.find(
    n => (n.type === "peak" || n.type === "valley") && n.arcIndex === arcIndex,
  );
}

/**
 * Get all visible nodes for a specific arc (nodes with arcSlot <= arcIndex).
 */
export function getVisibleNodesForArc(plan: CoordinationPlan, arcIndex: number): CoordinationNode[] {
  const visibleIds = new Set(plan.arcPartitions[arcIndex - 1] ?? []);
  return plan.nodes.filter(n => visibleIds.has(n.id));
}

/**
 * Derive an arc's force mode from the composition of its own nodes
 * (those with arcSlot === arcIndex). Four primary force categories:
 *  - fate: fate nodes + spine nodes carrying a threadId
 *  - world: character + location + artifact nodes
 *  - system: system nodes
 *  - chaos: chaos nodes (outside-force injections that spawn new entities)
 *
 * The dominant category wins. If no category makes up ≥40% of the
 * counted nodes, or if the top two categories are within one node of
 * each other, the arc is balanced.
 */
export function deriveArcForceMode(plan: CoordinationPlan, arcIndex: number): ArcForceMode {
  const arcNodes = plan.nodes.filter(n => n.arcSlot === arcIndex);

  let fate = 0;
  let world = 0;
  let system = 0;
  let chaos = 0;

  for (const n of arcNodes) {
    if (n.type === "fate") {
      fate++;
    } else if (n.type === "character" || n.type === "location" || n.type === "artifact") {
      world++;
    } else if (n.type === "system") {
      system++;
    } else if (n.type === "chaos") {
      chaos++;
    } else if (n.type === "peak" || n.type === "valley" || n.type === "moment") {
      // Spine nodes that carry a threadId count as fate pressure
      if (n.threadId) fate++;
    }
  }

  const total = fate + world + system + chaos;
  if (total === 0) return "balanced";

  const ranked: { mode: ArcForceMode; count: number }[] = (
    [
      { mode: "fate-dominant", count: fate },
      { mode: "world-dominant", count: world },
      { mode: "system-dominant", count: system },
      { mode: "chaos-dominant", count: chaos },
    ] as { mode: ArcForceMode; count: number }[]
  ).sort((a, b) => b.count - a.count);

  const top = ranked[0];
  const runnerUp = ranked[1];
  const dominanceThreshold = 0.4;

  if (top.count / total < dominanceThreshold) return "balanced";
  if (top.count - runnerUp.count <= 0) return "balanced";
  return top.mode;
}

/**
 * Compute forceMode for every arc in the plan and attach it to each
 * arc's anchor node. Mutation returns a new nodes array — the original
 * plan is untouched.
 */
export function applyDerivedForceModes(plan: CoordinationPlan): CoordinationPlan {
  const newNodes = plan.nodes.map(n => {
    const isAnchor =
      (n.type === "peak" || n.type === "valley") && n.arcIndex !== undefined;
    if (!isAnchor) return n;
    return { ...n, forceMode: deriveArcForceMode(plan, n.arcIndex!) };
  });
  return { ...plan, nodes: newNodes };
}

/**
 * Build a directive from coordination plan nodes for the current arc.
 * This replaces the pressure-based directive building when a plan is active.
 */
export function buildPlanDirective(
  narrative: NarrativeState,
  plan: CoordinationPlan,
  arcIndex: number,
): string {
  const sections: string[] = [];
  const visibleNodes = getVisibleNodesForArc(plan, arcIndex);
  const arcNode = getArcNode(plan, arcIndex);

  // Arc header
  sections.push(`## Coordination Plan — Arc ${arcIndex} of ${plan.arcCount}`);
  if (arcNode) {
    sections.push(`Arc: ${arcNode.label}`);
    if (arcNode.forceMode) {
      sections.push(`Force Mode: ${arcNode.forceMode}`);
    }
    if (arcNode.sceneCount) {
      sections.push(`Target Scenes: ${arcNode.sceneCount}`);
    }
    if (arcNode.detail) {
      sections.push(`\n${arcNode.detail}`);
    }
  }

  // Thread targets — spine nodes (peak/valley/moment) carrying a threadId,
  // grouped and labelled by their structural role.
  const isSpineNode = (t: string) => t === "peak" || t === "valley" || t === "moment";
  const threadTargets = visibleNodes.filter(n => isSpineNode(n.type) && n.threadId);
  if (threadTargets.length > 0) {
    sections.push("\n## Thread Targets");
    for (const node of threadTargets) {
      const thread = narrative.threads[node.threadId!];
      const threadDesc = thread?.description ?? node.threadId;
      const isResolution = node.targetStatus === "resolved" || node.targetStatus === "subverted";
      const targetType =
        node.type === "peak" && isResolution ? "PEAK — MUST REACH"
        : node.type === "peak" ? "PEAK"
        : node.type === "valley" ? "VALLEY — PIVOT"
        : "MOMENT";
      sections.push(`- [${node.targetStatus ?? "progress"}] ${threadDesc} — ${targetType}: ${node.label}`);
    }
  }

  // Fate pressures (fate nodes visible to this arc)
  const fateNodes = visibleNodes.filter(n => n.type === "fate" && n.threadId);
  if (fateNodes.length > 0) {
    sections.push("\n## Fate Pressures");
    for (const node of fateNodes) {
      const thread = narrative.threads[node.threadId!];
      const threadDesc = thread?.description ?? node.threadId;
      sections.push(`- ${threadDesc}: ${node.label}`);
      if (node.detail) {
        sections.push(`  → ${node.detail}`);
      }
    }
  }

  // Reasoning nodes
  const reasoningNodes = visibleNodes.filter(n => n.type === "reasoning");
  if (reasoningNodes.length > 0) {
    sections.push("\n## Strategic Reasoning");
    for (const node of reasoningNodes) {
      sections.push(`- ${node.label}`);
      if (node.detail) {
        sections.push(`  → ${node.detail}`);
      }
    }
  }

  // Pattern and warning nodes
  const patterns = visibleNodes.filter(n => n.type === "pattern");
  const warnings = visibleNodes.filter(n => n.type === "warning");

  if (patterns.length > 0) {
    sections.push("\n## Patterns to Embrace");
    for (const node of patterns) {
      sections.push(`+ ${node.label}`);
    }
  }

  if (warnings.length > 0) {
    sections.push("\n## Pitfalls to Avoid");
    for (const node of warnings) {
      sections.push(`! ${node.label}`);
    }
  }

  // Entity constraints
  const entityNodes = visibleNodes.filter(
    n => ["character", "location", "artifact", "system"].includes(n.type) && n.entityId
  );
  if (entityNodes.length > 0) {
    sections.push("\n## Entity Constraints");
    for (const node of entityNodes) {
      const entityName = getEntityName(narrative, node.entityId!, node.type);
      sections.push(`- [${node.type}] ${entityName}: ${node.label}`);
    }
  }

  return sections.join("\n");
}

/**
 * Get the scene count for an arc from the plan.
 */
export function getArcSceneCount(plan: CoordinationPlan, arcIndex: number, defaultCount: number): number {
  const arcNode = getArcNode(plan, arcIndex);
  return arcNode?.sceneCount ?? defaultCount;
}

/**
 * Build a simplified directive for fast generation (no detailed reasoning).
 * Used when useArcReasoning is false.
 */
export function buildSimplePlanDirective(
  plan: CoordinationPlan,
  arcIndex: number,
): string {
  const arcNode = getArcNode(plan, arcIndex);
  const lines: string[] = [];

  lines.push(`Arc ${arcIndex} of ${plan.arcCount}`);
  if (arcNode) {
    lines.push(`Focus: ${arcNode.label}`);
    if (arcNode.forceMode) {
      lines.push(`Mode: ${arcNode.forceMode}`);
    }
  }

  return lines.join("\n");
}

/**
 * Check if the coordination plan is complete.
 */
export function isPlanComplete(branchPlan: BranchPlan): boolean {
  const { plan } = branchPlan;
  return plan.currentArc >= plan.arcCount && plan.completedArcs.length >= plan.arcCount;
}

/**
 * Helper to get entity name from narrative.
 */
function getEntityName(
  narrative: NarrativeState,
  entityId: string,
  nodeType: string,
): string {
  switch (nodeType) {
    case "character":
      return narrative.characters[entityId]?.name ?? entityId;
    case "location":
      return narrative.locations[entityId]?.name ?? entityId;
    case "artifact":
      return narrative.artifacts?.[entityId]?.name ?? entityId;
    default:
      return entityId;
  }
}
