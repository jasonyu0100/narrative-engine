import type { NarrativeState, Scene, StorySettings, RelationshipEdge, WorldEdge, ProseProfile, SystemGraph } from '@/types/narrative';
import { resolveEntry, THREAD_ACTIVE_STATUSES, THREAD_TERMINAL_STATUSES, THREAD_STATUS_LABELS, DEFAULT_STORY_SETTINGS } from '@/types/narrative';
import { buildCumulativeSystemGraph, rankSystemNodes, resolveEntityName } from '@/lib/narrative-utils';
import { WORDS_PER_SCENE, ENTITY_LOG_CONTEXT_LIMIT, NEAR_RECENCY_ZONE, MID_RECENCY_ZONE } from '@/lib/constants';
import { getIntroducedIds } from '@/lib/scene-filter';

// ── Prose Profile Builder ─────────────────────────────────────────────────────

/**
 * Build prose profile as plain text for LLM context.
 */
export function buildProseProfile(profile: ProseProfile, options?: { beatDensity?: number }): string {
  const parts: string[] = [];

  // Voice characteristics as a single line
  const voice: string[] = [];
  if (profile.register) voice.push(profile.register);
  if (profile.stance) voice.push(profile.stance);
  if (profile.tense) voice.push(profile.tense);
  if (profile.sentenceRhythm) voice.push(profile.sentenceRhythm);
  if (profile.interiority) voice.push(`${profile.interiority} interiority`);
  if (profile.dialogueWeight) voice.push(`${profile.dialogueWeight} dialogue`);
  if (voice.length) parts.push(`Voice: ${voice.join(', ')}`);

  if (profile.devices?.length) {
    parts.push(`Devices: ${profile.devices.join(', ')}`);
  }
  if (profile.rules?.length) {
    parts.push(`Rules: ${profile.rules.join('; ')}`);
  }
  if (profile.antiPatterns?.length) {
    parts.push(`Avoid: ${profile.antiPatterns.join('; ')}`);
  }
  if (options?.beatDensity != null) {
    parts.push(`Density reference: ~${options.beatDensity} beats/kword (a soft signal — choose only as many beats as the scene needs)`);
  }

  return `PROSE PROFILE\n${parts.join('\n')}`;
}

/**
 * Replay deltas up to a given timeline index to get the state at that point.
 * Returns which continuity nodes exist, relationship states, thread statuses,
 * and artifact ownership at the specified position in the timeline.
 */

// ── Tiered scene-history resolution ───────────────────────────────────────────
// Scene history is rendered at progressively lower resolution the further back
// a scene sits from the current one. The floor is a scene summary (plus POV /
// location) — we never drop a scene entirely. Important scenes (thread
// transitions into or out of a load-bearing status) are promoted one tier so
// critical beats survive aggressive truncation in long narratives.
//
// To add a tier: extend `RecencyTier`, add a row to `TIER_FIELDS`, and update
// `classifyTier`. `renderSceneEntry` reads TIER_FIELDS and needs no changes.

export type RecencyTier = 'near' | 'mid' | 'far';

/** Which delta categories each tier reveals. Lower tiers strictly include the floor. */
interface TierFields {
  participants: boolean;
  threadTransitions: boolean;
  movements: boolean;          // tieDeltas (characters entering/leaving locations)
  worldDeltas: boolean;
  relationshipShifts: boolean;
  artifactUsages: boolean;
  ownershipChanges: boolean;
}

const TIER_FIELDS: Record<RecencyTier, TierFields> = {
  near: { participants: true,  threadTransitions: true,  movements: true,  worldDeltas: true,  relationshipShifts: true,  artifactUsages: true,  ownershipChanges: true  },
  // Mid drops participants — thread-transition names already imply who's present.
  mid:  { participants: false, threadTransitions: true,  movements: true,  worldDeltas: false, relationshipShifts: false, artifactUsages: false, ownershipChanges: false },
  far:  { participants: false, threadTransitions: false, movements: false, worldDeltas: false, relationshipShifts: false, artifactUsages: false, ownershipChanges: false },
};

/** Thread statuses whose transitions mark load-bearing scenes. */
const IMPORTANT_THREAD_STATUSES = new Set(['escalating', 'critical', 'resolved', 'subverted']);

/** A scene is important if a thread delta touches an escalating/critical/resolved/subverted status. */
function isImportantScene(s: Scene): boolean {
  return s.threadDeltas.some((tm) =>
    IMPORTANT_THREAD_STATUSES.has(tm.from) || IMPORTANT_THREAD_STATUSES.has(tm.to),
  );
}

/** Pick a tier from distance-to-current, then promote one step if the scene is important. */
export function classifyTier(
  distanceFromCurrent: number,
  important: boolean,
  nearZone: number,
  midZone: number,
): RecencyTier {
  const base: RecencyTier =
    distanceFromCurrent < nearZone ? 'near' :
    distanceFromCurrent < nearZone + midZone ? 'mid' :
    'far';
  if (!important) return base;
  if (base === 'far') return 'mid';
  if (base === 'mid') return 'near';
  return 'near';
}

/**
 * Return the tier a knowledge or log node belongs to, based on the scene it
 * was introduced in. Seed nodes (introduced by a pre-timeline world build or
 * otherwise untracked) are treated as 'seed' and always kept.
 */
export function tierOfOrigin(
  sceneOriginIndex: number | undefined,
  totalScenes: number,
  sceneImportance: boolean[],
  nearZone: number,
  midZone: number,
): RecencyTier | 'seed' {
  if (sceneOriginIndex === undefined) return 'seed';
  const distance = totalScenes - 1 - sceneOriginIndex;
  return classifyTier(distance, sceneImportance[sceneOriginIndex] ?? false, nearZone, midZone);
}

/** Render a single scene at the given tier. Fields are gated by TIER_FIELDS. */
function renderSceneEntry(
  n: NarrativeState,
  s: Scene,
  globalIdx: number,
  tier: RecencyTier,
): string {
  const fields = TIER_FIELDS[tier];
  const loc = n.locations[s.locationId]?.name ?? s.locationId;
  const povName = n.characters[s.povId]?.name ?? s.povId;
  const attrs: string[] = [
    `index="${globalIdx}"`,
    `tier="${tier}"`,
    `location="${loc}"`,
    `pov="${povName}"`,
  ];

  if (fields.participants) {
    const participants = s.participantIds.map((pid) => n.characters[pid]?.name ?? pid).join(', ');
    if (participants) attrs.push(`participants="${participants}"`);
  }

  if (fields.threadTransitions) {
    const threadChanges = s.threadDeltas.map((tm) => {
      const thr = n.threads[tm.threadId];
      const desc = thr ? thr.description : tm.threadId;
      return `${desc}: ${tm.from}->${tm.to}`;
    }).join('; ');
    if (threadChanges) attrs.push(`threads="${threadChanges}"`);
  }

  if (fields.worldDeltas) {
    const continuityChanges = s.worldDeltas.flatMap((km) => {
      const entityName = n.characters[km.entityId]?.name ?? n.locations[km.entityId]?.name ?? n.artifacts[km.entityId]?.name ?? km.entityId;
      return (km.addedNodes ?? []).map((node) => `${entityName} learned [${node.type}]: ${node.content}`);
    }).join('; ');
    if (continuityChanges) attrs.push(`continuity="${continuityChanges}"`);
  }

  if (fields.relationshipShifts) {
    const relChanges = s.relationshipDeltas.map((rm) => {
      const fromName = n.characters[rm.from]?.name ?? rm.from;
      const toName = n.characters[rm.to]?.name ?? rm.to;
      return `${fromName}->${toName}: ${rm.type} (${rm.valenceDelta >= 0 ? '+' : ''}${Math.round(rm.valenceDelta * 100) / 100})`;
    }).join('; ');
    if (relChanges) attrs.push(`relationships="${relChanges}"`);
  }

  if (fields.ownershipChanges) {
    const ownershipChanges = (s.ownershipDeltas ?? []).map((om) => {
      const artName = n.artifacts?.[om.artifactId]?.name ?? om.artifactId;
      const fromName = n.characters[om.fromId]?.name ?? n.locations[om.fromId]?.name ?? om.fromId;
      const toName = n.characters[om.toId]?.name ?? n.locations[om.toId]?.name ?? om.toId;
      return `${artName}: ${fromName}→${toName}`;
    }).join('; ');
    if (ownershipChanges) attrs.push(`artifact-transfers="${ownershipChanges}"`);
  }

  if (fields.artifactUsages) {
    const artifactUsages = (s.artifactUsages ?? []).map((au) => {
      const artName = n.artifacts?.[au.artifactId]?.name ?? au.artifactId;
      const usageDesc = au.usage ? ` (${au.usage})` : '';
      if (!au.characterId) return `${artName} used${usageDesc}`;
      const charName = n.characters[au.characterId]?.name ?? au.characterId;
      return `${charName} uses ${artName}${usageDesc}`;
    }).join('; ');
    if (artifactUsages) attrs.push(`artifact-usages="${artifactUsages}"`);
  }

  if (fields.movements) {
    const tieChanges = (s.tieDeltas ?? []).map((mm) => {
      const locName = n.locations[mm.locationId]?.name ?? mm.locationId;
      const charName = n.characters[mm.characterId]?.name ?? mm.characterId;
      return `${charName} ${mm.action === 'add' ? 'joins' : 'leaves'} ${locName}`;
    }).join('; ');
    if (tieChanges) attrs.push(`ties="${tieChanges}"`);
  }

  return `<entry ${attrs.join(' ')}>${s.summary}</entry>`;
}

export function getStateAtIndex(
  n: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): {
  /** Continuity node IDs that existed at this point (added and not removed) */
  liveNodeIds: Set<string>;
  /** Relationship states at this point (replayed from deltas) */
  relationships: RelationshipEdge[];
  /** Thread statuses at this point */
  threadStatuses: Record<string, string>;
  /** Artifact ownership at this point (artifactId -> ownerId) */
  artifactOwnership: Record<string, string | null>;
} {
  const keysUpToCurrent = resolvedKeys.slice(0, currentIndex + 1);

  // Replay world deltas to get accumulated node IDs (additive only)
  const liveNodeIds = new Set<string>();
  for (const k of keysUpToCurrent) {
    const entry = resolveEntry(n, k);
    if (entry?.kind !== 'scene') continue;
    for (const km of entry.worldDeltas) {
      for (const node of km.addedNodes ?? []) {
        if (node.id) liveNodeIds.add(node.id);
      }
    }
  }

  // Replay relationship deltas to get state at this point
  const relMap = new Map<string, RelationshipEdge>();
  for (const k of keysUpToCurrent) {
    const entry = resolveEntry(n, k);
    if (entry?.kind !== 'scene') continue;
    for (const rm of entry.relationshipDeltas) {
      const key = `${rm.from}:${rm.to}`;
      const existing = relMap.get(key);
      if (existing) {
        relMap.set(key, {
          ...existing,
          type: rm.type,
          valence: Math.max(-1, Math.min(1, existing.valence + rm.valenceDelta)),
        });
      } else {
        relMap.set(key, {
          from: rm.from,
          to: rm.to,
          type: rm.type,
          valence: Math.max(-1, Math.min(1, rm.valenceDelta)),
        });
      }
    }
  }

  // Replay thread deltas to get status at this point
  const threadStatuses: Record<string, string> = {};
  for (const k of keysUpToCurrent) {
    const entry = resolveEntry(n, k);
    if (entry?.kind !== 'scene') continue;
    for (const tm of entry.threadDeltas) {
      threadStatuses[tm.threadId] = tm.to;
    }
  }

  // Replay artifact ownership: start with initial parentIds from worldBuilds, then apply ownershipDeltas
  const artifactOwnership: Record<string, string | null> = {};
  for (const k of keysUpToCurrent) {
    const entry = resolveEntry(n, k);
    // WorldBuilds introduce artifacts with initial parentIds
    if (entry?.kind === 'world_build') {
      for (const a of entry.expansionManifest.newArtifacts ?? []) {
        artifactOwnership[a.id] = a.parentId;
      }
    }
    // Scenes can transfer ownership
    if (entry?.kind === 'scene') {
      for (const om of entry.ownershipDeltas ?? []) {
        artifactOwnership[om.artifactId] = om.toId;
      }
    }
  }

  return {
    liveNodeIds,
    relationships: [...relMap.values()],
    threadStatuses,
    artifactOwnership,
  };
}

// Build thread lifecycle documentation from canonical status lists
export const THREAD_LIFECYCLE_DOC = (() => {
  const activeList = THREAD_ACTIVE_STATUSES.map((s) => `"${s}"`).join(', ');
  const terminalList = THREAD_TERMINAL_STATUSES.map(
    (s) => `"${s}" (${THREAD_STATUS_LABELS[s]})`,
  ).join(', ');
  return `Active statuses: ${activeList}. Terminal/closed statuses: ${terminalList}.`;
})();

/**
 * Build system knowledge block from SystemGraph.
 * Consolidates what was previously split between rules[] and worldSystems[].
 *
 * Node types map to:
 * - principle: Fundamental truths (laws, axioms, magic rules)
 * - system: Organized mechanisms (governance, ecosystems, magic systems)
 * - constraint: Hard limits (scarcity, costs, boundaries)
 * - convention: Norms (customs, practices, etiquette)
 * - Other types included for completeness
 */
function buildSystemKnowledgeBlock(graph: SystemGraph): string {
  const nodes = Object.values(graph.nodes);
  if (nodes.length === 0) return '';

  // Group nodes by type
  const byType: Record<string, typeof nodes> = {};
  for (const node of nodes) {
    if (!byType[node.type]) byType[node.type] = [];
    byType[node.type].push(node);
  }

  // Build adjacency for showing connections — reference target IDs, not target text.
  // The target concept is already written once on its own node; inlining the full
  // text per edge can duplicate the world-graph block several times over.
  const connections: Record<string, string[]> = {};
  for (const edge of graph.edges) {
    const fromNode = graph.nodes[edge.from];
    const toNode = graph.nodes[edge.to];
    if (!fromNode || !toNode) continue;
    if (!connections[edge.from]) connections[edge.from] = [];
    connections[edge.from].push(`${edge.relation}→${edge.to}`);
  }

  const sections: string[] = [];

  // Principles first (these are the "rules")
  if (byType['principle']?.length) {
    const lines = byType['principle'].map((n) => {
      const conn = connections[n.id];
      const connStr = conn?.length ? ` [${conn.join('; ')}]` : '';
      return `  <principle id="${n.id}">${n.concept}${connStr}</principle>`;
    });
    sections.push(`<principles hint="Fundamental truths — these MUST be obeyed.">\n${lines.join('\n')}\n</principles>`);
  }

  // Systems (organized mechanisms)
  if (byType['system']?.length) {
    const lines = byType['system'].map((n) => {
      const conn = connections[n.id];
      const connStr = conn?.length ? ` [${conn.join('; ')}]` : '';
      return `  <system id="${n.id}">${n.concept}${connStr}</system>`;
    });
    sections.push(`<systems hint="Organized mechanisms — use these to drive conflict and reward preparation.">\n${lines.join('\n')}\n</systems>`);
  }

  // Constraints (hard limits)
  if (byType['constraint']?.length) {
    const lines = byType['constraint'].map((n) => {
      const conn = connections[n.id];
      const connStr = conn?.length ? ` [${conn.join('; ')}]` : '';
      return `  <constraint id="${n.id}">${n.concept}${connStr}</constraint>`;
    });
    sections.push(`<constraints hint="Hard limits — costs, scarcity, boundaries that cannot be ignored.">\n${lines.join('\n')}\n</constraints>`);
  }

  // Tensions (unresolved forces)
  if (byType['tension']?.length) {
    const lines = byType['tension'].map((n) => {
      const conn = connections[n.id];
      const connStr = conn?.length ? ` [${conn.join('; ')}]` : '';
      return `  <tension id="${n.id}">${n.concept}${connStr}</tension>`;
    });
    sections.push(`<tensions hint="Unresolved contradictions — sources of conflict.">\n${lines.join('\n')}\n</tensions>`);
  }

  // Other types grouped together
  const otherTypes = ['concept', 'event', 'structure', 'environment', 'convention'];
  const otherNodes = otherTypes.flatMap((t) => byType[t] ?? []);
  if (otherNodes.length > 0) {
    const lines = otherNodes.map((n) => {
      const conn = connections[n.id];
      const connStr = conn?.length ? ` [${conn.join('; ')}]` : '';
      return `  <node type="${n.type}" id="${n.id}">${n.concept}${connStr}</node>`;
    });
    sections.push(`<world-knowledge hint="Additional established facts.">\n${lines.join('\n')}\n</world-knowledge>`);
  }

  if (sections.length === 0) return '';

  return `\n<world-graph hint="Established system knowledge. Scenes must operate within these truths.">\n${sections.join('\n\n')}\n</world-graph>\n`;
}


/** Build a prompt block from story settings — returns empty string if all defaults */
export function buildStorySettingsBlock(n: NarrativeState): string {
  const s: StorySettings = { ...DEFAULT_STORY_SETTINGS, ...n.storySettings };
  const lines: string[] = [];

  // POV mode
  const povLabels: Record<string, string> = {
    single: 'SINGLE POV — every scene must use the same POV character.',
    pareto: 'PARETO POV — the designated anchor is POV in ~80% of scenes. The remaining ~20% may use other entities when a different vantage delivers something the anchor cannot — information, counterpoint, ironic juxtaposition, or deliberate formal braiding. Default to the anchor; switch for reason, not inertia. "Variety for its own sake" is weak; counterpoint, irony, and braiding are all legitimate reasons beyond pure information.',
    dual: 'DUAL POV — use exactly two POV characters. POV typically comes in STREAKS (2-4 scenes per character before switching). An ABAB pattern is disorienting for most dramatic registers — prefer AAABBB or AAABB. Switch when the other character delivers information, counterpoint, or braiding the current POV cannot.',
    ensemble: 'ENSEMBLE POV — rotate POV among the designated characters. For most dramatic registers, POV should come in STREAKS (2-4 scenes per character before switching). For declared polyphonic, choral, or mosaic forms (e.g. Faulkner-style polyvocality, Caribbean polyvocal tradition, works built on per-scene rotation), per-scene or per-paragraph rotation IS the form — honour the declared form over the default streak length.',
    free: '', // no constraint
  };
  if (s.povMode !== 'free') {
    lines.push(povLabels[s.povMode]);
    if (s.povCharacterIds.length > 0) {
      const names = s.povCharacterIds
        .map((id) => n.characters[id] ? `${n.characters[id].name} (${id})` : id)
        .join(', ');
      if (s.povMode === 'pareto') {
        lines.push(`Anchor: ${names}. Use this entity as POV in ~80% of scenes. The remaining ~20% may use ANY other entity when a different vantage delivers information, counterpoint, ironic juxtaposition, or formal braiding the anchor cannot.`);
      } else {
        lines.push(`Designated POV character${s.povCharacterIds.length > 1 ? 's' : ''}: ${names}. Only these characters may appear in the "povId" field.`);
      }
    }
  } else if (s.povCharacterIds.length > 0) {
    const names = s.povCharacterIds
      .map((id) => n.characters[id] ? `${n.characters[id].name} (${id})` : id)
      .join(', ');
    lines.push(`FREE POV with preferred characters: ${names}. Favour these characters as POV when the scene fits their perspective, but you may use any character when a different vantage is narratively stronger.`);
  }

  // Story direction
  if (s.storyDirection.trim()) {
    lines.push(`STORY DIRECTION (high-level north star): ${s.storyDirection.trim()}`);
  }

  // Story constraints (negative prompt)
  if (s.storyConstraints.trim()) {
    lines.push(`STORY CONSTRAINTS (DO NOT do any of the following): ${s.storyConstraints.trim()}`);
  }

  // Narrative guidance (editorial principles)
  if (s.narrativeGuidance.trim()) {
    lines.push(`NARRATIVE GUIDANCE (editorial principles that govern how this story is told — scope discipline, reveal pacing, tonal rules, structural philosophy. These override default instincts):\n${s.narrativeGuidance.trim()}`);
  }

  // Story patterns (positive commandments)
  if (n.patterns && n.patterns.length > 0) {
    lines.push(`STORY PATTERNS (positive commandments — what makes this series good):\n${n.patterns.map(p => `• ${p}`).join('\n')}`);
  }

  // Story anti-patterns (negative commandments)
  if (n.antiPatterns && n.antiPatterns.length > 0) {
    lines.push(`STORY ANTI-PATTERNS (negative commandments — what to avoid):\n${n.antiPatterns.map(p => `• ${p}`).join('\n')}`);
  }

  if (lines.length === 0) return '';
  return `\n<story-settings>\n${lines.join('\n')}\n</story-settings>\n`;
}

export function narrativeContext(
  n: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): string {
  // The entire branch up to the current scene is included. Resolution is
  // tiered by distance from the current scene (see NEAR_RECENCY_ZONE /
  // MID_RECENCY_ZONE) rather than by a hard cutoff.
  const keysUpToCurrent = resolvedKeys.slice(0, currentIndex + 1);

  // Collect entity IDs, knowledge node IDs, and per-scene metadata on one pass.
  // sceneImportance / knowledgeOriginScene / threadLogOriginScene drive the
  // tiered continuity pruning below — knowledge and thread-log nodes are
  // rendered only if the scene they came from is still in near/mid tier
  // (important scenes get promoted, so load-bearing history survives).
  const referencedCharIds = new Set<string>();
  const referencedLocIds = new Set<string>();
  const referencedThreadIds = new Set<string>();
  const horizonContinuityNodeIds = new Set<string>();
  const totalEntries = keysUpToCurrent.length;
  const sceneImportance: boolean[] = new Array(totalEntries).fill(false);
  const knowledgeOriginScene = new Map<string, number>();
  const threadLogOriginScene = new Map<string, number>();
  const relationshipLatestDeltaScene = new Map<string, number>();
  keysUpToCurrent.forEach((k, i) => {
    const entry = resolveEntry(n, k);
    if (!entry) return;
    if (entry.kind === 'scene') {
      sceneImportance[i] = isImportantScene(entry);
      referencedCharIds.add(entry.povId);
      for (const pid of entry.participantIds) referencedCharIds.add(pid);
      referencedLocIds.add(entry.locationId);
      for (const tm of entry.threadDeltas) {
        referencedThreadIds.add(tm.threadId);
        for (const node of tm.addedNodes ?? []) {
          if (!threadLogOriginScene.has(node.id)) threadLogOriginScene.set(node.id, i);
        }
      }
      for (const km of entry.worldDeltas) {
        referencedCharIds.add(km.entityId);
        for (const node of km.addedNodes ?? []) {
          horizonContinuityNodeIds.add(node.id);
          if (!knowledgeOriginScene.has(node.id)) knowledgeOriginScene.set(node.id, i);
        }
      }
      for (const rm of entry.relationshipDeltas) {
        referencedCharIds.add(rm.from);
        referencedCharIds.add(rm.to);
        // Track latest delta scene per undirected relationship pair so we can
        // drop relationships whose last change lives in far tier.
        const pairKey = rm.from < rm.to ? `${rm.from}|${rm.to}` : `${rm.to}|${rm.from}`;
        relationshipLatestDeltaScene.set(pairKey, i);
      }
      if (entry.characterMovements) {
        for (const [charId, mv] of Object.entries(entry.characterMovements)) {
          referencedCharIds.add(charId);
          referencedLocIds.add(mv.locationId);
        }
      }
    } else if (entry.kind === 'world_build') {
      for (const c of entry.expansionManifest.newCharacters) referencedCharIds.add(c.id);
      for (const l of entry.expansionManifest.newLocations) referencedLocIds.add(l.id);
      for (const t of entry.expansionManifest.newThreads) referencedThreadIds.add(t.id);
    }
  });

  // A knowledge/log node survives pruning if its origin scene is in near/mid tier.
  // Seed nodes (no recorded origin — typically introduced by a world build) always survive.
  const keepByRecency = (originMap: Map<string, number>) => (id: string): boolean => {
    const tier = tierOfOrigin(originMap.get(id), totalEntries, sceneImportance, NEAR_RECENCY_ZONE, MID_RECENCY_ZONE);
    return tier !== 'far';
  };
  const keepKnowledgeNode = keepByRecency(knowledgeOriginScene);
  const keepThreadLogNode = keepByRecency(threadLogOriginScene);
  // Also include threads that anchor to referenced characters/locations
  for (const t of Object.values(n.threads)) {
    if (referencedThreadIds.has(t.id)) continue;
    for (const anchor of t.participants) {
      if ((anchor.type === 'character' && referencedCharIds.has(anchor.id)) ||
          (anchor.type === 'location' && referencedLocIds.has(anchor.id))) {
        referencedThreadIds.add(t.id);
        break;
      }
    }
  }
  // Include parent locations of referenced locations
  for (const locId of [...referencedLocIds]) {
    const loc = n.locations[locId];
    if (loc?.parentId && n.locations[loc.parentId]) referencedLocIds.add(loc.parentId);
  }

  // If no scenes exist yet (initial generation), include all entities
  const hasHistory = referencedCharIds.size > 0 || referencedLocIds.size > 0;
  const branchCharacters = hasHistory
    ? Object.values(n.characters).filter((c) => referencedCharIds.has(c.id))
    : Object.values(n.characters);
  const branchLocations = hasHistory
    ? Object.values(n.locations).filter((l) => referencedLocIds.has(l.id))
    : Object.values(n.locations);
  const branchThreads = hasHistory
    ? Object.values(n.threads).filter((t) => referencedThreadIds.has(t.id))
    : Object.values(n.threads);

  // Get timeline-scoped state: continuity nodes, relationships, and thread statuses
  // that existed at this point in the timeline (not future state)
  const timelineState = getStateAtIndex(n, resolvedKeys, currentIndex);
  const branchRelationships = hasHistory
    ? timelineState.relationships.filter((r) => referencedCharIds.has(r.from) && referencedCharIds.has(r.to))
    : timelineState.relationships;

  // Knowledge: keep original (non-delta) nodes + delta nodes from the time horizon
  const introduced = getIntroducedIds(n.worldBuilds, n.scenes, resolvedKeys, currentIndex);
  const artifactEntries = Object.values(n.artifacts ?? {}).filter((a) => introduced.artifactIds.has(a.id));
  // Use timeline-scoped ownership (who owned each artifact at this point, not final state)
  const artifactsByOwner = new Map<string, typeof artifactEntries>();
  for (const a of artifactEntries) {
    const ownerId = timelineState.artifactOwnership[a.id] ?? a.parentId ?? '__world__';
    const list = artifactsByOwner.get(ownerId) ?? [];
    list.push(a);
    artifactsByOwner.set(ownerId, list);
  }

  // Helper: render continuity graph (nodes + edges) as XML — mirrors system knowledge rendering
  const renderContinuityXml = (nodes: { id: string; type: string; content: string }[], edges: WorldEdge[], indent: string) => {
    const nodeIds = new Set(nodes.map(n => n.id));
    const nodeLines = nodes.map((kn) => `${indent}<knowledge id="${kn.id}" type="${kn.type}">${kn.content}</knowledge>`);
    const relevantEdges = edges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to));
    const edgeLines = relevantEdges.map(e => `${indent}<edge from="${e.from}" to="${e.to}" relation="${e.relation}" />`);
    return [...nodeLines, ...edgeLines];
  };

  // Recency-tiered continuity: keep nodes that are alive at the current index
  // AND whose origin scene is still in near/mid tier. Slicing by
  // ENTITY_LOG_CONTEXT_LIMIT guards against runaway early-story world dumps
  // on entities with many seed nodes.
  const tieredContinuity = (nodes: Record<string, { id: string; type: string; content: string }>) =>
    Object.values(nodes)
      .filter((kn) => timelineState.liveNodeIds.has(kn.id) && keepKnowledgeNode(kn.id))
      .slice(-ENTITY_LOG_CONTEXT_LIMIT);

  const characters = branchCharacters
    .map((c) => {
      const recentNodes = tieredContinuity(c.world.nodes);
      const continuityLines = renderContinuityXml(recentNodes, c.world.edges, '  ');
      const owned = artifactsByOwner.get(c.id) ?? [];
      const artifactLines = owned.map((a) => {
        const recentArtNodes = tieredContinuity(a.world.nodes);
        const inner = renderContinuityXml(recentArtNodes, a.world.edges, '    ').join('\n');
        return `  <artifact id="${a.id}" name="${a.name}" significance="${a.significance}">${inner ? `\n${inner}\n  ` : ''}</artifact>`;
      });
      const continuityBlock = continuityLines.length > 0 ? `\n${continuityLines.join('\n')}` : '';
      const artifactBlock = artifactLines.length > 0 ? `\n${artifactLines.join('\n')}` : '';
      return `<character id="${c.id}" name="${c.name}" role="${c.role}">${continuityBlock}${artifactBlock}\n</character>`;
    })
    .join('\n');
  const locations = branchLocations
    .map((l) => {
      const recentNodes = tieredContinuity(l.world.nodes);
      const continuityLines = renderContinuityXml(recentNodes, l.world.edges, '  ');
      const parent = l.parentId ? ` parent="${n.locations[l.parentId]?.name ?? l.parentId}"` : '';
      const owned = artifactsByOwner.get(l.id) ?? [];
      const artifactLines = owned.map((a) => {
        const recentArtNodes = tieredContinuity(a.world.nodes);
        const inner = renderContinuityXml(recentArtNodes, a.world.edges, '    ').join('\n');
        return `  <artifact id="${a.id}" name="${a.name}" significance="${a.significance}">${inner ? `\n${inner}\n  ` : ''}</artifact>`;
      });
      const continuityBlock = continuityLines.length > 0 ? `\n${continuityLines.join('\n')}` : '';
      const artifactBlock = artifactLines.length > 0 ? `\n${artifactLines.join('\n')}` : '';
      const tiedNames = (l.tiedCharacterIds ?? []).map(id => n.characters[id]?.name).filter(Boolean);
      const tiesAttr = tiedNames.length > 0 ? ` ties="${tiedNames.join(', ')}"` : '';
      return `<location id="${l.id}" name="${l.name}" prominence="${l.prominence ?? 'place'}"${parent}${tiesAttr}>${continuityBlock}${artifactBlock}\n</location>`;
    })
    .join('\n');
  // Build thread age context from scene history (within time horizon)
  const threadFirstDelta: Record<string, number> = {};
  const threadDeltaCount: Record<string, number> = {};
  keysUpToCurrent.forEach((k, idx) => {
    const scene = n.scenes[k];
    if (!scene) return;
    for (const tm of scene.threadDeltas) {
      threadDeltaCount[tm.threadId] = (threadDeltaCount[tm.threadId] ?? 0) + 1;
      if (threadFirstDelta[tm.threadId] === undefined) threadFirstDelta[tm.threadId] = idx;
    }
  });
  const totalScenes = keysUpToCurrent.length;

  const threads = branchThreads
    .map((t) => {
      const firstMut = threadFirstDelta[t.id];
      const age = firstMut !== undefined ? totalScenes - firstMut : 0;
      const deltas = threadDeltaCount[t.id] ?? 0;
      const participantNames = t.participants.map((a) => n.characters[a.id]?.name ?? n.locations[a.id]?.name ?? a.id).join(', ');
      const validDeps = t.dependents.filter((id) => n.threads[id]);
      const depsAttr = validDeps.length > 0 ? ` converges="${validDeps.join(',')}"` : '';
      // Use timeline-scoped status, falling back to base status if no deltas yet
      const status = timelineState.threadStatuses[t.id] ?? t.status;
      // Filter out abandoned threads — they're cleaned up and shouldn't appear in generation context
      if (status === 'abandoned') return null;
      // Recency-tiered log entries: keep logs from near/mid scenes only. Older
      // log detail is carried by scene-history summaries.
      const logNodes = Object.values(t.threadLog?.nodes ?? {})
        .filter((ln) => keepThreadLogNode(ln.id))
        .slice(-ENTITY_LOG_CONTEXT_LIMIT);
      const logBlock = logNodes.length > 0
        ? `\n  <log>${logNodes.map((ln) => `[${ln.type}] ${ln.content}`).join(' | ')}</log>`
        : '';
      return `<thread id="${t.id}" status="${status}"${age > 0 ? ` age="${age}" deltas="${deltas}"` : ''}${participantNames ? ` participants="${participantNames}"` : ''}${depsAttr}>${t.description}${logBlock}\n</thread>`;
    })
    .filter(Boolean)
    .join('\n');
  // Recency-tiered relationships: keep only pairs whose latest delta is in
  // near/mid tier. Scene-history summaries carry stable long-term dynamics.
  const relationships = branchRelationships
    .filter((r) => {
      const pairKey = r.from < r.to ? `${r.from}|${r.to}` : `${r.to}|${r.from}`;
      const tier = tierOfOrigin(relationshipLatestDeltaScene.get(pairKey), totalEntries, sceneImportance, NEAR_RECENCY_ZONE, MID_RECENCY_ZONE);
      return tier !== 'far';
    })
    .map((r) => {
      const fromName = n.characters[r.from]?.name ?? r.from;
      const toName = n.characters[r.to]?.name ?? r.to;
      return `<relationship from="${fromName}" to="${toName}" valence="${Math.round(r.valence * 100) / 100}">${r.type}</relationship>`;
    })
    .join('\n');
  // Tiered scene history — see classifyTier / renderSceneEntry at the top of
  // this file. World-build entries always render as a single summary line
  // (their structural content lives in the characters/locations/threads
  // blocks above).
  const tierCounts = { near: 0, mid: 0, far: 0 };
  const sceneHistory = keysUpToCurrent.map((k, i) => {
    const s = resolveEntry(n, k);
    if (!s) return '';
    const globalIdx = i + 1;
    const distanceFromCurrent = totalEntries - 1 - i;
    if (s.kind === 'world_build') {
      return `<entry index="${globalIdx}" type="world-build">${s.summary}</entry>`;
    }
    const tier = classifyTier(distanceFromCurrent, isImportantScene(s), NEAR_RECENCY_ZONE, MID_RECENCY_ZONE);
    tierCounts[tier]++;
    return renderSceneEntry(n, s, globalIdx, tier);
  }).filter(Boolean).join('\n');

  // Arcs context — only arcs with scenes within the time horizon
  const branchSceneIds = new Set(keysUpToCurrent.filter((k) => n.scenes[k]));
  const arcs = Object.values(n.arcs)
    .filter((a) => !hasHistory || a.sceneIds.some((sid) => branchSceneIds.has(sid)))
    .map((a) => {
      const developsNames = a.develops.map((tid) => n.threads[tid]?.description ?? tid).join(', ');
      return `<arc id="${a.id}" name="${a.name}" scenes="${a.sceneIds.length}">${developsNames}</arc>`;
    })
    .join('\n');

  // ── System Knowledge Graph (scoped to time horizon) ────────────────
  const horizonSystemGraph = buildCumulativeSystemGraph(
    n.scenes, keysUpToCurrent, keysUpToCurrent.length - 1, n.worldBuilds,
  );
  const rankedSystemNodes = rankSystemNodes(horizonSystemGraph);
  let systemGraphBlock = '';
  if (rankedSystemNodes.length > 0) {
    // Build adjacency map for each node → connected node IDs
    const adjacency = new Map<string, string[]>();
    for (const e of horizonSystemGraph.edges) {
      if (!horizonSystemGraph.nodes[e.from] || !horizonSystemGraph.nodes[e.to]) continue;
      adjacency.set(e.from, [...(adjacency.get(e.from) ?? []), e.to]);
      adjacency.set(e.to, [...(adjacency.get(e.to) ?? []), e.from]);
    }

    // Show each node as XML with ID, type, and connections
    const nodeLines = rankedSystemNodes.map(({ node }) => {
      const connections = adjacency.get(node.id);
      const connAttr = connections && connections.length > 0
        ? ` connects="${connections.join(', ')}"`
        : '';
      return `<node id="${node.id}" type="${node.type}"${connAttr}>${node.concept}</node>`;
    });

    const totalNodes = Object.keys(horizonSystemGraph.nodes).length;
    const totalEdges = horizonSystemGraph.edges.length;
    systemGraphBlock = `
<system-graph nodes="${totalNodes}" edges="${totalEdges}" hint="Reference existing IDs when relevant. New nodes need edges.">
${nodeLines.join('\n')}
</system-graph>
`;
  }

  // Compact ID lookup — placed last so it's closest to the generation prompt
  // Exclude abandoned threads from valid IDs — they shouldn't be referenced in generation
  const charIdList = branchCharacters.map((c) => c.id).join(', ');
  const locIdList = branchLocations.map((l) => l.id).join(', ');
  const activeThreads = branchThreads.filter((t) => (timelineState.threadStatuses[t.id] ?? t.status) !== 'abandoned');
  const threadIdList = activeThreads.map((t) => t.id).join(', ');
  const sysIdList = rankedSystemNodes.map(({ node }) => node.id).join(', ');

  // Build system knowledge from SystemGraph (consolidates old rules + worldSystems)
  const systemKnowledgeBlock = buildSystemKnowledgeBlock(horizonSystemGraph);

  const storySettingsBlock = buildStorySettingsBlock(n);

  const historyNote = `${keysUpToCurrent.length} scenes — ${tierCounts.near} near, ${tierCounts.mid} mid, ${tierCounts.far} far (resolution falls with distance from current)`;

  return `<narrative title="${n.title}">
${systemKnowledgeBlock}${storySettingsBlock}
<characters hint="Continuity tracks what each character knows. Use this to determine what they can reference, discover, or be surprised by.">
${characters}
</characters>

<locations hint="Nested via parent attribute. Characters must physically travel between locations — no teleportation.">
${locations}
</locations>

<threads hint="Threads are COMPELLING QUESTIONS (stakes + uncertainty + investment). Lifecycle: latent → seeded → active → escalating → critical → resolved/subverted. Thread logs track incremental answers.">
${threads}
</threads>

<relationships hint="Valence: negative = hostile/tense, positive = warm/allied. All interactions must reflect the current valence. Shifts happen through dramatic moments, not narration.">
${relationships}
</relationships>

<arcs hint="Each arc develops specific threads. New arcs should continue momentum from previous ones.">
${arcs}
</arcs>

<scene-history scope="${historyNote}" hint="Source of truth for long-term continuity. Summaries carry the branch; near/mid entries expose deltas for recent scenes.">
${sceneHistory}
</scene-history>
${systemGraphBlock}
<valid-ids hint="You MUST use ONLY these exact IDs — do NOT invent new ones.">
  <characters>${charIdList}</characters>
  <locations>${locIdList}</locations>
  <threads>${threadIdList}</threads>${artifactEntries.length > 0 ? `\n  <artifacts>${artifactEntries.map((a) => a.id).join(', ')}</artifacts>` : ''}${sysIdList ? `\n  <system-nodes>${sysIdList}</system-nodes>` : ''}
</valid-ids>
</narrative>`;
}

export function sceneContext(
  narrative: NarrativeState,
  scene: Scene,
  /* eslint-disable @typescript-eslint/no-unused-vars */
  _resolvedKeys?: string[],
  _currentIndex?: number,
  /* eslint-enable @typescript-eslint/no-unused-vars */
): string {
  // DELTAS + NEW ENTITIES ONLY. Scene context describes what THIS scene
  // introduces or changes — not cumulative world state. Callers that need
  // continuity context should combine this with narrativeContext, not
  // duplicate state here.
  const location = narrative.locations[scene.locationId];
  const pov = narrative.characters[scene.povId];
  const arc = Object.values(narrative.arcs).find((a) => a.sceneIds.includes(scene.id));

  // ── Participant identifiers (no cumulative knowledge) ───────────────
  const participantLines = scene.participantIds.map((pid) => {
    const p = narrative.characters[pid];
    if (!p) return `  <participant id="${pid}" />`;
    return `  <participant id="${p.id}" name="${p.name}" role="${p.role}" />`;
  });

  // ── Scene deltas ───────────────────────────────────────────────────
  const threadDeltaLines = scene.threadDeltas.map((tm) => {
    const thread = narrative.threads[tm.threadId];
    const addedLogs = (tm.addedNodes ?? [])
      .map((n) => `[${n.type}] ${n.content}`)
      .join(' | ');
    const logAttr = addedLogs ? ` log="${addedLogs.replace(/"/g, '&quot;')}"` : '';
    return `  <shift thread="${thread?.description ?? tm.threadId}" from="${tm.from}" to="${tm.to}"${logAttr} />`;
  });

  const worldDeltaLines = scene.worldDeltas.flatMap((km) => {
    const entityName = resolveEntityName(narrative, km.entityId);
    return (km.addedNodes ?? []).map(node => `  <change entity="${entityName}" type="${node.type}">${node.content}</change>`);
  });

  const relationshipDeltaLines = scene.relationshipDeltas.map((rm) => {
    const fromName = narrative.characters[rm.from]?.name ?? rm.from;
    const toName = narrative.characters[rm.to]?.name ?? rm.to;
    return `  <shift from="${fromName}" to="${toName}" delta="${rm.valenceDelta >= 0 ? '+' : ''}${Math.round(rm.valenceDelta * 100) / 100}">${rm.type}</shift>`;
  });

  const movementLines = scene.characterMovements
    ? Object.entries(scene.characterMovements).map(([charId, mv]) => {
        const char = narrative.characters[charId];
        const loc = narrative.locations[mv.locationId];
        return `  <movement character="${char?.name ?? charId}" to="${loc?.name ?? mv.locationId}">${mv.transition}</movement>`;
      })
    : [];

  const artifactUsageLines = (scene.artifactUsages ?? []).map((au) => {
    const artName = narrative.artifacts?.[au.artifactId]?.name ?? au.artifactId;
    const usageAttr = au.usage ? ` what="${au.usage}"` : '';
    if (!au.characterId) return `  <usage artifact="${artName}"${usageAttr} />`;
    const charName = narrative.characters[au.characterId]?.name ?? au.characterId;
    return `  <usage artifact="${artName}" character="${charName}"${usageAttr} />`;
  });

  const ownershipDeltaLines = (scene.ownershipDeltas ?? []).map((om) => {
    const artName = resolveEntityName(narrative, om.artifactId);
    const fromName = resolveEntityName(narrative, om.fromId);
    const toName = resolveEntityName(narrative, om.toId);
    return `  <transfer artifact="${artName}" from="${fromName}" to="${toName}" />`;
  });

  const tieDeltaLines = (scene.tieDeltas ?? []).map((mm) => {
    const locName = narrative.locations[mm.locationId]?.name ?? mm.locationId;
    const charName = narrative.characters[mm.characterId]?.name ?? mm.characterId;
    return `  <tie character="${charName}" action="${mm.action}" location="${locName}" />`;
  });

  const wkmBlock = (() => {
    const wkm = scene.systemDeltas;
    if (!wkm || ((wkm.addedNodes?.length ?? 0) === 0 && (wkm.addedEdges?.length ?? 0) === 0)) return '';
    const lines: string[] = [];
    for (const node of wkm.addedNodes ?? []) {
      lines.push(`<node id="${node.id}" type="${node.type}">${node.concept}</node>`);
    }
    for (const edge of wkm.addedEdges ?? []) {
      lines.push(`<edge from="${edge.from}" to="${edge.to}" relation="${edge.relation}"/>`);
    }
    return `\n<system-reveals>\n${lines.join('\n')}\n</system-reveals>`;
  })();

  // ── New entities introduced by this scene ──────────────────────────
  const newCharacterLines = (scene.newCharacters ?? []).map((c) => {
    const knLines = Object.values(c.world?.nodes ?? {})
      .map((kn) => `    <knowledge type="${kn.type}">${kn.content}</knowledge>`);
    const knBlock = knLines.length > 0 ? `\n${knLines.join('\n')}` : '';
    return `  <character id="${c.id}" name="${c.name}" role="${c.role}">${knBlock}\n  </character>`;
  });

  const newLocationLines = (scene.newLocations ?? []).map((l) => {
    const knLines = Object.values(l.world?.nodes ?? {})
      .map((kn) => `    <knowledge type="${kn.type}">${kn.content}</knowledge>`);
    const knBlock = knLines.length > 0 ? `\n${knLines.join('\n')}` : '';
    const parent = l.parentId ? ` parent="${narrative.locations[l.parentId]?.name ?? l.parentId}"` : '';
    return `  <location id="${l.id}" name="${l.name}" prominence="${l.prominence}"${parent}>${knBlock}\n  </location>`;
  });

  const newArtifactLines = (scene.newArtifacts ?? []).map((a) => {
    const knLines = Object.values(a.world?.nodes ?? {})
      .map((kn) => `    <knowledge type="${kn.type}">${kn.content}</knowledge>`);
    const knBlock = knLines.length > 0 ? `\n${knLines.join('\n')}` : '';
    const owner = a.parentId ? ` owner="${resolveEntityName(narrative, a.parentId)}"` : '';
    return `  <artifact id="${a.id}" name="${a.name}" significance="${a.significance}"${owner}>${knBlock}\n  </artifact>`;
  });

  const newThreadLines = (scene.newThreads ?? []).map((t) => {
    const parts = (t.participants ?? [])
      .map((p) => {
        if (p.type === 'character') return narrative.characters[p.id]?.name ?? p.id;
        if (p.type === 'location') return narrative.locations[p.id]?.name ?? p.id;
        return p.id;
      })
      .join(', ');
    const partsAttr = parts ? ` participants="${parts}"` : '';
    return `  <thread id="${t.id}" status="${t.status}"${partsAttr}>${t.description}</thread>`;
  });

  const newEntitiesBlock = [
    newCharacterLines.length > 0 ? `<new-characters>\n${newCharacterLines.join('\n')}\n</new-characters>` : '',
    newLocationLines.length > 0 ? `<new-locations>\n${newLocationLines.join('\n')}\n</new-locations>` : '',
    newArtifactLines.length > 0 ? `<new-artifacts>\n${newArtifactLines.join('\n')}\n</new-artifacts>` : '',
    newThreadLines.length > 0 ? `<new-threads>\n${newThreadLines.join('\n')}\n</new-threads>` : '',
  ].filter(Boolean).join('\n');

  return `<scene id="${scene.id}" arc="${arc?.name ?? 'standalone'}" pov="${pov?.name ?? 'Unknown'}" location="${location?.name ?? 'Unknown'}">
<summary>${scene.summary}</summary>
${participantLines.length > 0 ? `\n<participants>\n${participantLines.join('\n')}\n</participants>` : ''}
${newEntitiesBlock ? `\n${newEntitiesBlock}` : ''}

<events>
${scene.events.map((e) => `  <event>${e}</event>`).join('\n')}
</events>
${threadDeltaLines.length > 0 ? `\n<thread-shifts>\n${threadDeltaLines.join('\n')}\n</thread-shifts>` : ''}
${worldDeltaLines.length > 0 ? `\n<world-changes>\n${worldDeltaLines.join('\n')}\n</world-changes>` : ''}
${relationshipDeltaLines.length > 0 ? `\n<relationship-shifts>\n${relationshipDeltaLines.join('\n')}\n</relationship-shifts>` : ''}${wkmBlock}
${movementLines.length > 0 ? `\n<movements>\n${movementLines.join('\n')}\n</movements>` : ''}
${artifactUsageLines.length > 0 ? `\n<artifact-usages>\n${artifactUsageLines.join('\n')}\n</artifact-usages>` : ''}
${ownershipDeltaLines.length > 0 ? `\n<artifact-transfers>\n${ownershipDeltaLines.join('\n')}\n</artifact-transfers>` : ''}
${tieDeltaLines.length > 0 ? `\n<tie-changes>\n${tieDeltaLines.join('\n')}\n</tie-changes>` : ''}
</scene>`;
}

/** Scene scale guidance. Brevity is the goal — the LLM chooses the beat
 *  count that exactly matches the scene's needs, with no fixed target.
 *  estWords remains as a soft reference for prose length only. */
export function sceneScale(_scene: Scene): { estWords: number; planWords: string } {
  return { estWords: WORDS_PER_SCENE, planWords: `${Math.round(WORDS_PER_SCENE * 0.3)}-${Math.round(WORDS_PER_SCENE * 0.5)}` };
}

/** Deterministically derive logical rules from the scene graph — no LLM needed.
 *  Returns structured XML string with categorized constraints the prose must obey. */
export function deriveLogicRules(
  narrative: NarrativeState,
  scene: Scene,
  resolvedKeys?: string[],
  currentIndex?: number,
): string {
  const sections: string[] = [];

  // Get timeline-scoped state when resolvedKeys and currentIndex are provided
  const timelineState = resolvedKeys && currentIndex !== undefined
    ? getStateAtIndex(narrative, resolvedKeys, currentIndex)
    : null;

  // Helper to get character's knowledge nodes scoped to timeline
  const getCharacterKnowledge = (charId: string) => {
    const char = narrative.characters[charId];
    if (!char) return [];
    const allCharNodes = Object.values(char.world.nodes);
    return timelineState
      ? allCharNodes.filter((kn) => timelineState.liveNodeIds.has(kn.id))
      : allCharNodes;
  };

  const participantIdSet = new Set(scene.participantIds);
  const location = narrative.locations[scene.locationId];
  const pov = narrative.characters[scene.povId];

  // NOTE: Spatial constraints and POV-lock are NOT included here because:
  // - sceneContext already provides location, pov, and participants
  // - proseProfile's "stance" setting already establishes POV rules (close_third, etc.)
  // Logic context focuses on scene-specific knowledge boundaries and deltas.

  // ═══════════════════════════════════════════════════════════════════════════
  // KNOWLEDGE STATE (POV's knowledge at scene start vs. what they learn)
  // ═══════════════════════════════════════════════════════════════════════════
  if (pov) {
    const povKnowledge = getCharacterKnowledge(pov.id);
    // Knowledge being added to POV this scene — they don't have it at the START
    const povLearnsNodes = scene.worldDeltas
      .filter((km) => km.entityId === pov.id)
      .flatMap((km) => km.addedNodes ?? []);
    const povLearnsNodeIds = new Set(povLearnsNodes.map((n) => n.id));
    // POV's knowledge at scene START = timeline-scoped graph - things learned this scene
    const povStartKnowledge = povKnowledge.filter((kn) => !povLearnsNodeIds.has(kn.id));

    const knowledgeLines: string[] = [];
    if (povStartKnowledge.length > 0) {
      const items = povStartKnowledge.map((kn) => kn.content);
      knowledgeLines.push(`  <knows-at-start count="${povStartKnowledge.length}">${items.join(' | ')}</knows-at-start>`);
    }
    if (povLearnsNodes.length > 0) {
      for (const node of povLearnsNodes) {
        knowledgeLines.push(`  <learns-during-scene>${node.content}</learns-during-scene>`);
      }
    }
    if (knowledgeLines.length > 0) {
      sections.push(`<knowledge-state character="${pov.name}" role="pov">
${knowledgeLines.join('\n')}
  <constraint>Narration is limited to knowledge the POV possesses. Before any "learns-during-scene" moment, do not reference that information. Show genuine discovery, not dramatic irony from the narrator.</constraint>
</knowledge-state>`);
    }

    // Other entities learning this scene (non-POV)
    const grouped = new Map<string, string[]>();
    for (const km of scene.worldDeltas) {
      if (km.entityId === pov.id) continue;
      const entity = narrative.characters[km.entityId] ?? narrative.locations[km.entityId] ?? narrative.artifacts[km.entityId];
      if (!entity) continue;
      const name = entity.name;
      for (const node of km.addedNodes ?? []) {
        const list = grouped.get(name) ?? [];
        list.push(node.content);
        grouped.set(name, list);
      }
    }
    for (const [entityName, items] of grouped) {
      sections.push(`<knowledge-state entity="${entityName}" role="participant">
  ${items.map((i) => `<learns-during-scene>${i}</learns-during-scene>`).join('\n  ')}
  <constraint>Show ${entityName}'s discovery only through observable reaction — not internal thoughts.</constraint>
</knowledge-state>`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // KNOWLEDGE ASYMMETRY (what others know that POV doesn't)
  // ═══════════════════════════════════════════════════════════════════════════
  if (pov) {
    const povKnowledge = getCharacterKnowledge(pov.id);
    const povKnowledgeIds = new Set(povKnowledge.map((kn) => kn.id));
    const povLearnsNodeIds = new Set(
      scene.worldDeltas
        .filter((km) => km.entityId === pov.id)
        .flatMap((km) => (km.addedNodes ?? []).map(n => n.id)),
    );

    const asymmetryLines: string[] = [];

    // Per-participant asymmetry
    for (const pid of scene.participantIds) {
      if (pid === pov.id) continue;
      const other = narrative.characters[pid];
      if (!other) continue;
      const otherKnowledge = getCharacterKnowledge(pid);
      const otherExclusive = otherKnowledge.filter(
        (kn) => !povKnowledgeIds.has(kn.id) && !povLearnsNodeIds.has(kn.id),
      );
      if (otherExclusive.length > 0) {
        const examples = otherExclusive.map((kn) => kn.content);
        asymmetryLines.push(`  <hidden-from-pov holder="${other.name}">${examples.join(' | ')}</hidden-from-pov>`);
      }
    }

    if (asymmetryLines.length > 0) {
      sections.push(`<knowledge-asymmetry pov="${pov.name}">
${asymmetryLines.join('\n')}
  <constraint>Do not reveal hidden knowledge through narration. ${pov.name} can only observe external behaviour and draw their own (possibly wrong) conclusions.</constraint>
</knowledge-asymmetry>`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // THREAD TRANSITIONS
  // ═══════════════════════════════════════════════════════════════════════════
  if (scene.threadDeltas.length > 0) {
    const threadLines = scene.threadDeltas.map((tm) => {
      const thread = narrative.threads[tm.threadId];
      const desc = thread?.description ?? tm.threadId;
      return `  <thread name="${desc}" from="${tm.from}" to="${tm.to}" />`;
    });
    sections.push(`<threads hint="Each thread begins in its 'from' state and must transition to its 'to' state during the scene">
${threadLines.join('\n')}
</threads>`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RELATIONSHIPS (static state + deltas)
  // ═══════════════════════════════════════════════════════════════════════════
  const baseRelationships = timelineState?.relationships ?? narrative.relationships;
  const participantRelationships = baseRelationships.filter(
    (r) => participantIdSet.has(r.from) && participantIdSet.has(r.to),
  );

  // Compute pre-scene valence by subtracting this scene's deltas
  const valenceDeltaMap = new Map<string, number>();
  for (const rm of scene.relationshipDeltas) {
    const key = `${rm.from}->${rm.to}`;
    valenceDeltaMap.set(key, (valenceDeltaMap.get(key) ?? 0) + rm.valenceDelta);
  }

  const relationshipLines: string[] = [];

  // Static relationships (no delta this scene) that are notably negative
  for (const r of participantRelationships) {
    const fromName = narrative.characters[r.from]?.name;
    const toName = narrative.characters[r.to]?.name;
    if (!fromName || !toName) continue;

    const key = `${r.from}->${r.to}`;
    const delta = valenceDeltaMap.get(key) ?? 0;
    if (delta !== 0) continue; // handled below in shifts

    const preSceneValence = Math.round((r.valence - delta) * 100) / 100;
    if (preSceneValence <= -0.5) {
      relationshipLines.push(`  <state from="${fromName}" to="${toName}" valence="${preSceneValence}" tone="hostile">${r.type}</state>`);
    } else if (preSceneValence <= -0.1) {
      relationshipLines.push(`  <state from="${fromName}" to="${toName}" valence="${preSceneValence}" tone="tense">${r.type}</state>`);
    }
  }

  // Relationship deltas
  for (const rm of scene.relationshipDeltas) {
    const fromName = narrative.characters[rm.from]?.name;
    const toName = narrative.characters[rm.to]?.name;
    if (!fromName || !toName) continue;
    const edge = baseRelationships.find((r) => r.from === rm.from && r.to === rm.to);
    const postValence = edge?.valence ?? 0;
    const preValence = Math.round((postValence - rm.valenceDelta) * 100) / 100;
    const delta = Math.round(rm.valenceDelta * 100) / 100;
    relationshipLines.push(`  <shift from="${fromName}" to="${toName}" start="${preValence}" delta="${delta >= 0 ? '+' : ''}${delta}" end="${Math.round(postValence * 100) / 100}" reason="${rm.type}" />`);
  }

  if (relationshipLines.length > 0) {
    sections.push(`<relationships hint="Interactions reflect these valences. In dramatic registers, shifts land through behaviour, dialogue, or action; in reflective or essayistic registers they may be named and attributed. Honour the declared register.">
${relationshipLines.join('\n')}
</relationships>`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REQUIRED EVENTS
  // ═══════════════════════════════════════════════════════════════════════════
  if (scene.events.length > 0) {
    const eventLines = scene.events.map((e) => `  <event>${e}</event>`);
    sections.push(`<events hint="All listed events must occur in this scene">
${eventLines.join('\n')}
</events>`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WORLD KNOWLEDGE (reveals + connections + established references)
  // ═══════════════════════════════════════════════════════════════════════════
  if (scene.systemDeltas) {
    const wkm = scene.systemDeltas;
    const newNodeIds = new Set((wkm.addedNodes ?? []).map((n) => n.id));
    const worldLines: string[] = [];

    // New concepts being revealed
    for (const addedNode of wkm.addedNodes ?? []) {
      if (!addedNode.concept) continue;
      const shortConcept = addedNode.concept.includes(' — ') ? addedNode.concept.split(' — ')[0] : addedNode.concept;
      worldLines.push(`  <reveal concept="${shortConcept}" type="${addedNode.type}" status="new">Show through demonstration or consequence, not exposition. Do not reference before revelation.</reveal>`);
    }

    // New connections
    for (const edge of wkm.addedEdges ?? []) {
      if (!edge.from || !edge.to) continue;
      const fromNode = narrative.systemGraph?.nodes[edge.from] ?? wkm.addedNodes?.find((n) => n.id === edge.from);
      const toNode = narrative.systemGraph?.nodes[edge.to] ?? wkm.addedNodes?.find((n) => n.id === edge.to);
      if (fromNode?.concept && toNode?.concept) {
        const fromShort = fromNode.concept.includes(' — ') ? fromNode.concept.split(' — ')[0] : fromNode.concept;
        const toShort = toNode.concept.includes(' — ') ? toNode.concept.split(' — ')[0] : toNode.concept;
        worldLines.push(`  <connection from="${fromShort}" relation="${edge.relation}" to="${toShort}">Show through action, dialogue, or consequence.</connection>`);
      }
    }

    // Existing concepts referenced
    const referencedExistingIds = new Set<string>();
    for (const edge of wkm.addedEdges ?? []) {
      if (!edge.from || !edge.to) continue;
      if (!newNodeIds.has(edge.from) && narrative.systemGraph?.nodes[edge.from]) referencedExistingIds.add(edge.from);
      if (!newNodeIds.has(edge.to) && narrative.systemGraph?.nodes[edge.to]) referencedExistingIds.add(edge.to);
    }
    if (referencedExistingIds.size > 0) {
      const established = [...referencedExistingIds].map((id) => {
        const node = narrative.systemGraph.nodes[id];
        return node?.concept ? (node.concept.includes(' — ') ? node.concept.split(' — ')[0] : node.concept) : id;
      });
      worldLines.push(`  <established hint="Can be referenced freely">${established.join(', ')}</established>`);
    }

    if (worldLines.length > 0) {
      sections.push(`<world-reveals>
${worldLines.join('\n')}
</world-reveals>`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CHARACTER MOVEMENTS
  // ═══════════════════════════════════════════════════════════════════════════
  if (scene.characterMovements && Object.keys(scene.characterMovements).length > 0) {
    const movementLines = Object.entries(scene.characterMovements).map(([charId, mv]) => {
      const char = narrative.characters[charId];
      const newLoc = narrative.locations[mv.locationId];
      if (!char || !newLoc) return null;
      return `  <movement character="${char.name}" from="${location?.name ?? 'current'}" to="${newLoc.name}" transition="${mv.transition}" />`;
    }).filter(Boolean);
    if (movementLines.length > 0) {
      sections.push(`<movements hint="Characters start at scene location and transition during the scene — do not show them already at destination">
${movementLines.join('\n')}
</movements>`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ARTIFACTS (possessions + location items + transfers)
  // ═══════════════════════════════════════════════════════════════════════════
  const artifacts = narrative.artifacts ?? {};
  const getArtifactOwner = (a: { id: string; parentId: string | null }) =>
    timelineState?.artifactOwnership[a.id] ?? a.parentId;
  const getArtifactCapabilities = (a: { world: { nodes: Record<string, { id: string; content: string }> } }) => {
    const allArtNodes = Object.values(a.world.nodes);
    const nodes = timelineState
      ? allArtNodes.filter((n) => timelineState.liveNodeIds.has(n.id))
      : allArtNodes;
    return nodes.map((n) => n.content).join('; ');
  };

  const artifactLines: string[] = [];

  // Participant possessions
  for (const pid of scene.participantIds) {
    const char = narrative.characters[pid];
    if (!char) continue;
    const owned = Object.values(artifacts).filter((a) => getArtifactOwner(a) === pid);
    if (owned.length > 0) {
      for (const a of owned) {
        const capabilities = getArtifactCapabilities(a);
        artifactLines.push(`  <possession owner="${char.name}" artifact="${a.name}"${capabilities ? ` capabilities="${capabilities}"` : ''} />`);
      }
    }
  }

  // Artifacts at location
  if (location) {
    const atLocation = Object.values(artifacts).filter((a) => getArtifactOwner(a) === scene.locationId);
    for (const a of atLocation) {
      artifactLines.push(`  <at-location artifact="${a.name}" location="${location.name}">Can be discovered and acquired.</at-location>`);
    }
  }

  // World-owned artifacts — always available
  const worldOwned = Object.values(artifacts).filter((a) => !getArtifactOwner(a));
  for (const a of worldOwned) {
    const capabilities = getArtifactCapabilities(a);
    artifactLines.push(`  <world-artifact artifact="${a.name}"${capabilities ? ` capabilities="${capabilities}"` : ''}>Communally available to all.</world-artifact>`);
  }

  // Ownership transfers
  for (const om of scene.ownershipDeltas ?? []) {
    const art = artifacts[om.artifactId];
    if (!art) continue;
    const fromName = resolveEntityName(narrative, om.fromId);
    const toName = resolveEntityName(narrative, om.toId);
    artifactLines.push(`  <transfer artifact="${art.name}" from="${fromName}" to="${toName}">Dramatise: discovery, gift, theft, trade, or seizure.</transfer>`);
  }

  if (artifactLines.length > 0) {
    sections.push(`<artifacts>
${artifactLines.join('\n')}
</artifacts>`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ASSEMBLE FINAL OUTPUT
  // ═══════════════════════════════════════════════════════════════════════════
  if (sections.length === 0) return '';

  const povName = pov?.name ?? scene.povId;
  const locName = location?.name ?? scene.locationId;

  return `<logic-context scene="${scene.id}" pov="${povName}" location="${locName}">
${sections.join('\n\n')}
</logic-context>`;
}

/**
 * Summary context — a condensed running summary of the story up to the current scene.
 * Shows scene summaries grouped by arc with POV, location, and key thread activity.
 * Much lighter than branchContext — designed for quick orientation without full delta detail.
 */
export function outlineContext(
  n: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): string {
  const keysUpToCurrent = resolvedKeys.slice(0, currentIndex + 1);

  // Group scenes by arc
  const arcForScene = new Map<string, string>();
  for (const arc of Object.values(n.arcs)) {
    for (const sid of arc.sceneIds) arcForScene.set(sid, arc.id);
  }

  // Build scene entries grouped by arc, with world commits as top-level markers between arcs
  type Section = { kind: 'arc'; arcName: string; entries: string[] } | { kind: 'world-commit'; line: string };
  const sections: Section[] = [];
  const arcGroupMap = new Map<string, Section & { kind: 'arc' }>();

  let sceneNum = 0;
  for (const k of keysUpToCurrent) {
    const entry = resolveEntry(n, k);
    if (!entry) continue;

    if (entry.kind === 'world_build') {
      sections.push({ kind: 'world-commit', line: `<world-commit>${entry.summary}</world-commit>` });
      continue;
    }

    sceneNum++;
    const arcId = arcForScene.get(entry.id);
    const arc = arcId ? n.arcs[arcId] : null;

    let group: Section & { kind: 'arc' };
    if (arcId && arcGroupMap.has(arcId)) {
      group = arcGroupMap.get(arcId)!;
    } else {
      const name = arc?.name ?? 'Standalone';
      group = { kind: 'arc', arcName: name, entries: [] };
      if (arcId) arcGroupMap.set(arcId, group);
      sections.push(group);
    }

    const povName = n.characters[entry.povId]?.name ?? entry.povId;
    const locName = n.locations[entry.locationId]?.name ?? entry.locationId;
    const threadChanges = entry.threadDeltas
      .map((tm) => {
        const t = n.threads[tm.threadId];
        return t ? `${t.description}: ${tm.from}→${tm.to}` : '';
      })
      .filter(Boolean)
      .join('; ');

    group.entries.push(
      `  <scene index="${sceneNum}" pov="${povName}" location="${locName}"${threadChanges ? ` threads="${threadChanges}"` : ''}>${entry.summary}</scene>`,
    );
  }

  // Format sections
  const arcSections = sections.map((s) => {
    if (s.kind === 'world-commit') return s.line;
    return `<arc name="${s.arcName}">\n${s.entries.join('\n')}\n</arc>`;
  }).join('\n\n');

  return `<story-summary title="${n.title}" scenes="${sceneNum}" hint="Narrative recap — scene-by-scene progression grouped by arc.">
${arcSections}
</story-summary>`;
}

