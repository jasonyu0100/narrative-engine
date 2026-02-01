import type {
  NarrativeState,
  AutoConfig,
  AutoAction,
  AutoActionWeight,
  AutoEndCondition,
  ForceSnapshot,
  Scene,
} from '@/types/narrative';
import { isScene } from '@/types/narrative';

// ── Terminal thread statuses ────────────────────────────────────────────────
const TERMINAL_STATUSES = new Set(['resolved', 'done', 'subverted', 'closed', 'abandoned']);
const ACTIVE_STATUSES = new Set(['surfacing', 'escalating', 'critical', 'fractured', 'converging', 'threatened']);

function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.has(status.toLowerCase());
}

function isActive(status: string): boolean {
  return ACTIVE_STATUSES.has(status.toLowerCase());
}

// ── Pacing profile multipliers ──────────────────────────────────────────────
const PACING_MULTIPLIERS: Record<string, Record<AutoAction, number>> = {
  deliberate:  { generate_arc: 1.0, expand_world: 1.5, resolve_thread: 1.0, escalate_toward_climax: 0.6, introduce_complication: 0.8, quiet_interlude: 1.3 },
  balanced:    { generate_arc: 1.0, expand_world: 1.0, resolve_thread: 1.0, escalate_toward_climax: 1.0, introduce_complication: 1.0, quiet_interlude: 1.0 },
  urgent:      { generate_arc: 1.2, expand_world: 0.5, resolve_thread: 1.3, escalate_toward_climax: 1.5, introduce_complication: 1.0, quiet_interlude: 0.4 },
  chaotic:     { generate_arc: 1.0, expand_world: 1.3, resolve_thread: 0.4, escalate_toward_climax: 1.0, introduce_complication: 1.8, quiet_interlude: 0.6 },
};

// ── Composite tension from force snapshot ───────────────────────────────────
function compositeTension(f: ForceSnapshot): number {
  return f.pressure * 0.4 + f.momentum * 0.3 + f.flux * 0.3;
}

// ── Check end conditions ────────────────────────────────────────────────────
export function checkEndConditions(
  narrative: NarrativeState,
  resolvedKeys: string[],
  config: AutoConfig,
): AutoEndCondition | null {
  for (const cond of config.endConditions) {
    switch (cond.type) {
      case 'scene_count':
        if (resolvedKeys.length >= cond.target) return cond;
        break;
      case 'all_threads_resolved': {
        const threads = Object.values(narrative.threads);
        if (threads.length > 0 && threads.every((t) => isTerminal(t.status))) return cond;
        break;
      }
      case 'arc_count':
        if (Object.keys(narrative.arcs).length >= cond.target) return cond;
        break;
      case 'manual_stop':
        break; // only triggered by user
    }
  }
  return null;
}

// ── Decision engine ─────────────────────────────────────────────────────────
export function evaluateNarrativeState(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  config: AutoConfig,
): AutoActionWeight[] {
  const scores: AutoActionWeight[] = [];
  const scenes = resolvedKeys.map((k) => narrative.scenes[k]).filter(Boolean).filter(isScene) as Scene[];
  const threads = Object.values(narrative.threads);
  const characters = Object.values(narrative.characters);
  const pacingMult = PACING_MULTIPLIERS[config.pacingProfile] ?? PACING_MULTIPLIERS.balanced;

  // ── Thread analysis ─────────────────────────────────────────────────────
  const activeThreads = threads.filter((t) => isActive(t.status));
  const dormantThreads = threads.filter((t) => t.status.toLowerCase() === 'dormant');
  const terminalThreads = threads.filter((t) => isTerminal(t.status));

  // Thread stagnation: how many scenes since each active thread was last mutated
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
    ? recentWindow.reduce((sum, s) => sum + compositeTension(s.forceSnapshot), 0) / recentWindow.length
    : 0.5;

  const tensionTrend = recentWindow.length >= 3
    ? compositeTension(recentWindow[recentWindow.length - 1].forceSnapshot) -
      compositeTension(recentWindow[0].forceSnapshot)
    : 0;

  // ── Character coverage ──────────────────────────────────────────────────
  const anchorCharacters = characters.filter((c) => c.role === 'anchor');
  const recentSceneWindow = scenes.slice(-config.minScenesBetweenCharacterFocus);
  const recentParticipants = new Set(recentSceneWindow.flatMap((s) => s.participantIds));
  const neglectedAnchors = config.characterRotationEnabled
    ? anchorCharacters.filter((c) => !recentParticipants.has(c.id))
    : [];

  // ── World saturation ────────────────────────────────────────────────────
  const allParticipantIds = new Set(scenes.flatMap((s) => s.participantIds));
  const unusedCharacters = characters.filter((c) => !allParticipantIds.has(c.id));
  const allLocationIds = new Set(scenes.map((s) => s.locationId));
  const unusedLocations = Object.values(narrative.locations).filter((l) => !allLocationIds.has(l.id));
  const worldSaturated = unusedCharacters.length > 3 || unusedLocations.length > 3;

  // ── Intelligent tension thresholds (hardcoded defaults) ─────────────────
  const tensionFloor = 0.25;
  const tensionCeiling = 0.85;

  // ── World build mode scoring ──────────────────────────────────────────
  const worldBuildBase: Record<string, number> = {
    off: 0,
    light: 0.15,
    moderate: 0.35,
    heavy: 0.6,
  };

  // ── Denouement detection ────────────────────────────────────────────────
  // After a high-tension peak followed by a drop, shift to resolution
  const isPostClimax = recentWindow.length >= 3 &&
    compositeTension(recentWindow[0].forceSnapshot) > 0.75 &&
    tensionTrend < -0.15;

  // ── Score each action ───────────────────────────────────────────────────

  // 1. Generate arc (default continuation)
  {
    let score = 0.5;
    const reasons: string[] = [];

    // Boost if current arc is complete (last scene is in a finished arc)
    const lastScene = scenes[scenes.length - 1];
    if (lastScene) {
      const lastArc = narrative.arcs[lastScene.arcId];
      const lastArcSceneIds = lastArc?.sceneIds ?? [];
      if (lastArcSceneIds[lastArcSceneIds.length - 1] === lastScene.id) {
        score += 0.2;
        reasons.push('current arc complete');
      }
    }

    if (dormantThreads.length > 2) {
      score += 0.15;
      reasons.push(`${dormantThreads.length} dormant threads to surface`);
    }

    if (neglectedAnchors.length > 0) {
      score += 0.1;
      reasons.push(`${neglectedAnchors.length} anchor characters need screen time`);
    }

    scores.push({ action: 'generate_arc', score: score * pacingMult.generate_arc, reason: reasons.join('; ') || 'continue the story' });
  }

  // 2. Expand world
  {
    let score = worldBuildBase[config.worldBuildMode] ?? 0;
    const reasons: string[] = [];

    if (config.worldBuildMode === 'off') {
      score = 0;
      reasons.push('world building disabled');
    } else if (worldSaturated) {
      score *= 0.3;
      reasons.push('many unused world elements');
    } else {
      if (Object.keys(narrative.locations).length < 4) {
        score += 0.2;
        reasons.push('world needs more locations');
      }
      if (characters.length < 4) {
        score += 0.2;
        reasons.push('world needs more characters');
      }
    }

    // Suppress in post-climax denouement
    if (isPostClimax) {
      score *= 0.3;
    }

    scores.push({ action: 'expand_world', score: score * pacingMult.expand_world, reason: reasons.join('; ') || 'enrich the world' });
  }

  // 3. Resolve thread
  {
    let score = 0.2;
    const reasons: string[] = [];

    if (activeThreads.length > config.maxActiveThreads) {
      score += 0.35;
      reasons.push(`${activeThreads.length} active threads exceeds cap of ${config.maxActiveThreads}`);
    }

    if (isPostClimax) {
      score += 0.4;
      reasons.push('post-climax: time to resolve');
    }

    if (stagnantThreads.length > 0) {
      score += 0.2;
      reasons.push(`${stagnantThreads.length} stagnant threads`);
    }

    scores.push({ action: 'resolve_thread', score: score * pacingMult.resolve_thread, reason: reasons.join('; ') || 'tie up loose ends' });
  }

  // 4. Escalate toward climax
  {
    let score = 0.3;
    const reasons: string[] = [];

    if (avgTension < tensionFloor) {
      score += 0.35;
      reasons.push(`tension ${avgTension.toFixed(2)} below floor`);
    }

    if (stagnantThreads.length > 0) {
      score += 0.15;
      reasons.push('stagnant threads need escalation');
    }

    if (isPostClimax) {
      score *= 0.2; // don't escalate after climax
    }

    scores.push({ action: 'escalate_toward_climax', score: score * pacingMult.escalate_toward_climax, reason: reasons.join('; ') || 'build tension' });
  }

  // 5. Introduce complication
  {
    let score = 0.25;
    const reasons: string[] = [];

    if (avgTension < tensionFloor) {
      score += 0.2;
      reasons.push('tension too low');
    }

    if (dormantThreads.length > 0 && activeThreads.length < config.maxActiveThreads) {
      score += 0.15;
      reasons.push('room for new complications');
    }

    if (tensionTrend < -0.1 && !isPostClimax) {
      score += 0.2;
      reasons.push('tension declining — needs a twist');
    }

    if (isPostClimax) {
      score *= 0.1; // suppress post-climax
    }

    scores.push({ action: 'introduce_complication', score: score * pacingMult.introduce_complication, reason: reasons.join('; ') || 'shake things up' });
  }

  // 6. Quiet interlude
  {
    let score = 0.15;
    const reasons: string[] = [];

    if (avgTension > tensionCeiling) {
      score += 0.4;
      reasons.push(`tension ${avgTension.toFixed(2)} above ceiling`);
    }

    if (tensionTrend > 0.2) {
      score += 0.15;
      reasons.push('sustained tension spike needs relief');
    }

    if (neglectedAnchors.length > 0) {
      score += 0.1;
      reasons.push('good opportunity for character development');
    }

    scores.push({ action: 'quiet_interlude', score: score * pacingMult.quiet_interlude, reason: reasons.join('; ') || 'breathing room' });
  }

  // Clamp scores to [0, 1] and sort descending
  return scores
    .map((s) => ({ ...s, score: Math.max(0, Math.min(1, s.score)) }))
    .sort((a, b) => b.score - a.score);
}

/** Pick the scene count for an auto-generated arc based on config and action type */
export function pickArcLength(config: AutoConfig, action: AutoAction): number {
  switch (action) {
    case 'quiet_interlude':
      return Math.min(2, config.minArcLength);
    case 'resolve_thread':
      return Math.min(3, config.maxArcLength);
    case 'escalate_toward_climax':
      return Math.max(config.minArcLength, Math.ceil((config.minArcLength + config.maxArcLength) / 2));
    case 'introduce_complication':
      return config.minArcLength;
    default:
      return Math.ceil((config.minArcLength + config.maxArcLength) / 2);
  }
}

/** Build the action-specific direction hint injected into AI prompts */
export function buildActionDirective(
  action: AutoAction,
  narrative: NarrativeState,
  resolvedKeys: string[],
  config: AutoConfig,
): string {
  const threads = Object.values(narrative.threads);
  const activeThreads = threads.filter((t) => isActive(t.status));
  const stagnantThreads = activeThreads.filter((t) => {
    const scenes = resolvedKeys.map((k) => narrative.scenes[k]).filter(Boolean).filter(isScene) as Scene[];
    let lastMut = -1;
    scenes.forEach((s, idx) => {
      if (s.threadMutations.some((tm) => tm.threadId === t.id)) lastMut = idx;
    });
    return (scenes.length - 1 - lastMut) >= config.threadStagnationThreshold;
  });

  const toneClause = config.toneGuidance ? `\nTone: ${config.toneGuidance}` : '';
  const constraintClause = config.narrativeConstraints ? `\nConstraints: ${config.narrativeConstraints}` : '';
  const directionClause = config.arcDirectionPrompt ? `\nGeneral direction: ${config.arcDirectionPrompt}` : '';

  switch (action) {
    case 'generate_arc':
      return `Continue the story naturally. Choose the most compelling next direction.${toneClause}${constraintClause}${directionClause}`;
    case 'escalate_toward_climax':
      return `ESCALATE the narrative toward a climax. Increase pressure and stakes dramatically. ${stagnantThreads.length > 0 ? `Force a crisis on these stagnant threads: ${stagnantThreads.map((t) => t.description).join(', ')}.` : 'Push the most critical thread toward a breaking point.'}${toneClause}${constraintClause}`;
    case 'introduce_complication':
      return `Introduce an unexpected COMPLICATION or twist. Surface a dormant threat, reveal a hidden truth, or create a new conflict that disrupts the current trajectory.${toneClause}${constraintClause}`;
    case 'resolve_thread': {
      const threadToResolve = stagnantThreads[0] ?? activeThreads[0];
      return `RESOLVE or bring to conclusion the thread: "${threadToResolve?.description ?? 'the most pressing thread'}". This arc should tie up this storyline definitively.${toneClause}${constraintClause}`;
    }
    case 'quiet_interlude':
      return `Create a QUIET INTERLUDE — a moment of calm between storms. Focus on character relationships, reflection, and planting seeds for future conflict. Keep tension low but introduce subtle foreshadowing.${toneClause}${constraintClause}`;
    case 'expand_world':
      return `Expand the world with new elements that serve the current narrative needs.${toneClause}${constraintClause}${directionClause}`;
  }
}
