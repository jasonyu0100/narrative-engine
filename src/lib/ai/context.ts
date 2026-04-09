import type { NarrativeState, Scene, StorySettings, WorldSystem, RelationshipEdge, ContinuityEdge } from '@/types/narrative';
import { resolveEntry, THREAD_ACTIVE_STATUSES, THREAD_TERMINAL_STATUSES, THREAD_STATUS_LABELS, DEFAULT_STORY_SETTINGS } from '@/types/narrative';
import { computeForceSnapshots, computeSwingMagnitudes, detectCubeCorner, movingAverage, FORCE_WINDOW_SIZE, computeDeliveryCurve, classifyCurrentPosition, buildCumulativeWorldKnowledge, rankWorldKnowledgeNodes } from '@/lib/narrative-utils';
import { SCENE_CONTEXT_RECENT_CONTINUITY, WORDS_PER_SCENE, BEATS_PER_SCENE } from '@/lib/constants';
import { getIntroducedIds } from '@/lib/scene-filter';

/**
 * Replay mutations up to a given timeline index to get the state at that point.
 * Returns which continuity nodes exist, relationship states, thread statuses,
 * and artifact ownership at the specified position in the timeline.
 */
export function getStateAtIndex(
  n: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): {
  /** Continuity node IDs that existed at this point (added and not removed) */
  liveNodeIds: Set<string>;
  /** Continuity edges that exist at this point (added and not removed) */
  liveEdges: ContinuityEdge[];
  /** Relationship states at this point (replayed from mutations) */
  relationships: RelationshipEdge[];
  /** Thread statuses at this point */
  threadStatuses: Record<string, string>;
  /** Artifact ownership at this point (artifactId -> ownerId) */
  artifactOwnership: Record<string, string | null>;
} {
  const keysUpToCurrent = resolvedKeys.slice(0, currentIndex + 1);

  // Replay continuity mutations to get accumulated node IDs and edges (additive only)
  const liveNodeIds = new Set<string>();
  const liveEdges: ContinuityEdge[] = [];
  for (const k of keysUpToCurrent) {
    const entry = resolveEntry(n, k);
    if (entry?.kind !== 'scene') continue;
    for (const km of entry.continuityMutations) {
      for (const node of km.addedNodes ?? []) {
        if (node.id) liveNodeIds.add(node.id);
      }
      for (const edge of km.addedEdges ?? []) {
        liveEdges.push(edge);
      }
    }
  }

  // Replay relationship mutations to get state at this point
  const relMap = new Map<string, RelationshipEdge>();
  for (const k of keysUpToCurrent) {
    const entry = resolveEntry(n, k);
    if (entry?.kind !== 'scene') continue;
    for (const rm of entry.relationshipMutations) {
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

  // Replay thread mutations to get status at this point
  const threadStatuses: Record<string, string> = {};
  for (const k of keysUpToCurrent) {
    const entry = resolveEntry(n, k);
    if (entry?.kind !== 'scene') continue;
    for (const tm of entry.threadMutations) {
      threadStatuses[tm.threadId] = tm.to;
    }
  }

  // Replay artifact ownership: start with initial parentIds from worldBuilds, then apply ownershipMutations
  const artifactOwnership: Record<string, string | null> = {};
  for (const k of keysUpToCurrent) {
    const entry = resolveEntry(n, k);
    // WorldBuilds introduce artifacts with initial parentIds
    if (entry?.kind === 'world_build') {
      for (const a of entry.expansionManifest.artifacts ?? []) {
        artifactOwnership[a.id] = a.parentId;
      }
    }
    // Scenes can transfer ownership
    if (entry?.kind === 'scene') {
      for (const om of entry.ownershipMutations ?? []) {
        artifactOwnership[om.artifactId] = om.toId;
      }
    }
  }

  return {
    liveNodeIds,
    liveEdges,
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

/** Build a structured world-systems block for prompts */
function buildWorldSystemsBlock(systems?: WorldSystem[]): string {
  if (!systems?.length) return '';

  const systemLines = systems.map((sys) => {
    const parts: string[] = [`<system name="${sys.name}">`];
    if (sys.description) parts.push(`  <description>${sys.description}</description>`);
    if (sys.principles.length > 0) {
      parts.push(`  <principles hint="How it works">`);
      for (const p of sys.principles) parts.push(`    - ${p}`);
      parts.push(`  </principles>`);
    }
    if (sys.constraints.length > 0) {
      parts.push(`  <constraints hint="Hard limits and costs">`);
      for (const c of sys.constraints) parts.push(`    - ${c}`);
      parts.push(`  </constraints>`);
    }
    if (sys.interactions.length > 0) {
      parts.push(`  <interactions hint="Cross-system connections">`);
      for (const ix of sys.interactions) parts.push(`    - ${ix}`);
      parts.push(`  </interactions>`);
    }
    parts.push(`</system>`);
    return parts.join('\n');
  });

  return `\n<world-systems hint="Structured mechanics that define how this world works. Scenes must operate within these systems — use them to drive conflict, constrain action, and reward preparation.">\n${systemLines.join('\n')}\n</world-systems>\n`;
}

/** Build a prompt block from story settings — returns empty string if all defaults */
export function buildStorySettingsBlock(n: NarrativeState): string {
  const s: StorySettings = { ...DEFAULT_STORY_SETTINGS, ...n.storySettings };
  const lines: string[] = [];

  // POV mode
  const povLabels: Record<string, string> = {
    single: 'SINGLE POV — every scene must use the same POV character.',
    pareto: 'PARETO POV — the designated protagonist is POV in ~80% of scenes. The remaining ~20% may use other characters, but ONLY when they hold critical perspective the protagonist cannot access (a scene happening elsewhere, an antagonist\'s private moment, a reveal that requires a different vantage). Default to the protagonist unless there is a strong narrative reason not to. Never switch POV for variety alone — switch only for information the reader needs that the protagonist cannot provide.',
    dual: 'DUAL POV — use exactly two POV characters. POV should come in STREAKS (2-4 scenes per character before switching). An ABAB pattern is disorienting — prefer AAABBB or AAABB. Switch only when the other character has something urgent the current POV cannot access.',
    ensemble: 'ENSEMBLE POV — rotate POV among the designated characters. POV should come in STREAKS (2-4 scenes per character before switching). Do NOT cycle rapidly through characters — stay with one perspective long enough for the reader to settle in. Switch when a different character holds the key perspective for the next dramatic moment.',
    free: '', // no constraint
  };
  if (s.povMode !== 'free') {
    lines.push(povLabels[s.povMode]);
    if (s.povCharacterIds.length > 0) {
      const names = s.povCharacterIds
        .map((id) => n.characters[id] ? `${n.characters[id].name} (${id})` : id)
        .join(', ');
      if (s.povMode === 'pareto') {
        lines.push(`Protagonist: ${names}. Use this character as POV in ~80% of scenes. The remaining ~20% may use ANY other character when they hold a perspective the protagonist cannot access.`);
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

  if (lines.length === 0) return '';
  return `\n<story-settings>\n${lines.join('\n')}\n</story-settings>\n`;
}

export function narrativeContext(
  n: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): string {
  // Apply time horizon from story settings (default: 50)
  const horizon = n.storySettings?.branchTimeHorizon ?? DEFAULT_STORY_SETTINGS.branchTimeHorizon;
  const allKeysUpToCurrent = resolvedKeys.slice(0, currentIndex + 1);
  const horizonStart = Math.max(0, allKeysUpToCurrent.length - horizon);
  const keysUpToCurrent = allKeysUpToCurrent.slice(horizonStart);
  const skippedCount = horizonStart;

  // Collect entity IDs and knowledge node IDs referenced within the time horizon
  const referencedCharIds = new Set<string>();
  const referencedLocIds = new Set<string>();
  const referencedThreadIds = new Set<string>();
  const horizonContinuityNodeIds = new Set<string>();
  for (const k of keysUpToCurrent) {
    const entry = resolveEntry(n, k);
    if (!entry) continue;
    if (entry.kind === 'scene') {
      referencedCharIds.add(entry.povId);
      for (const pid of entry.participantIds) referencedCharIds.add(pid);
      referencedLocIds.add(entry.locationId);
      for (const tm of entry.threadMutations) referencedThreadIds.add(tm.threadId);
      for (const km of entry.continuityMutations) {
        referencedCharIds.add(km.entityId);
        for (const node of km.addedNodes ?? []) horizonContinuityNodeIds.add(node.id);
      }
      for (const rm of entry.relationshipMutations) {
        referencedCharIds.add(rm.from);
        referencedCharIds.add(rm.to);
      }
      if (entry.characterMovements) {
        for (const [charId, mv] of Object.entries(entry.characterMovements)) {
          referencedCharIds.add(charId);
          referencedLocIds.add(mv.locationId);
        }
      }
    } else if (entry.kind === 'world_build') {
      for (const c of entry.expansionManifest.characters) referencedCharIds.add(c.id);
      for (const l of entry.expansionManifest.locations) referencedLocIds.add(l.id);
      for (const t of entry.expansionManifest.threads) referencedThreadIds.add(t.id);
    }
  }
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

  // Knowledge: keep original (non-mutation) nodes + mutation nodes from the time horizon
  const introduced = getIntroducedIds(n.worldBuilds, resolvedKeys, currentIndex);
  const artifactEntries = Object.values(n.artifacts ?? {}).filter((a) => introduced.artifactIds.has(a.id));
  // Use timeline-scoped ownership (who owned each artifact at this point, not final state)
  const artifactsByOwner = new Map<string, typeof artifactEntries>();
  for (const a of artifactEntries) {
    const ownerId = timelineState.artifactOwnership[a.id] ?? a.parentId ?? '__world__';
    const list = artifactsByOwner.get(ownerId) ?? [];
    list.push(a);
    artifactsByOwner.set(ownerId, list);
  }

  // Helper: render continuity graph (nodes + edges) as XML — mirrors world knowledge rendering
  const renderContinuityXml = (nodes: { id: string; type: string; content: string }[], edges: ContinuityEdge[], indent: string) => {
    const nodeIds = new Set(nodes.map(n => n.id));
    const nodeLines = nodes.map((kn) => `${indent}<knowledge id="${kn.id}" type="${kn.type}">${kn.content}</knowledge>`);
    const relevantEdges = edges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to));
    const edgeLines = relevantEdges.map(e => `${indent}<edge from="${e.from}" to="${e.to}" relation="${e.relation}" />`);
    return [...nodeLines, ...edgeLines];
  };

  const characters = branchCharacters
    .map((c) => {
      const relevantNodes = Object.values(c.continuity.nodes).filter((kn) => timelineState.liveNodeIds.has(kn.id));
      const omitted = Object.keys(c.continuity.nodes).length - relevantNodes.length;
      const omittedNote = omitted > 0 ? ` omitted="${omitted}"` : '';
      const continuityLines = renderContinuityXml(relevantNodes, c.continuity.edges, '  ');
      const owned = artifactsByOwner.get(c.id) ?? [];
      const artifactLines = owned.map((a) => {
        const scopedNodes = Object.values(a.continuity.nodes).filter((nd) => timelineState.liveNodeIds.has(nd.id));
        const inner = renderContinuityXml(scopedNodes, a.continuity.edges, '    ').join('\n');
        return `  <artifact id="${a.id}" name="${a.name}" significance="${a.significance}">${inner ? `\n${inner}\n  ` : ''}</artifact>`;
      });
      const continuityBlock = continuityLines.length > 0 ? `\n${continuityLines.join('\n')}` : '';
      const artifactBlock = artifactLines.length > 0 ? `\n${artifactLines.join('\n')}` : '';
      return `<character id="${c.id}" name="${c.name}" role="${c.role}"${omittedNote}>${continuityBlock}${artifactBlock}\n</character>`;
    })
    .join('\n');
  const locations = branchLocations
    .map((l) => {
      const relevantNodes = Object.values(l.continuity.nodes).filter((kn) => timelineState.liveNodeIds.has(kn.id));
      const continuityLines = renderContinuityXml(relevantNodes, l.continuity.edges, '  ');
      const parent = l.parentId ? ` parent="${n.locations[l.parentId]?.name ?? l.parentId}"` : '';
      const owned = artifactsByOwner.get(l.id) ?? [];
      const artifactLines = owned.map((a) => {
        const scopedNodes = Object.values(a.continuity.nodes).filter((nd) => timelineState.liveNodeIds.has(nd.id));
        const inner = renderContinuityXml(scopedNodes, a.continuity.edges, '    ').join('\n');
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
  const threadFirstMutation: Record<string, number> = {};
  const threadMutationCount: Record<string, number> = {};
  keysUpToCurrent.forEach((k, idx) => {
    const scene = n.scenes[k];
    if (!scene) return;
    for (const tm of scene.threadMutations) {
      threadMutationCount[tm.threadId] = (threadMutationCount[tm.threadId] ?? 0) + 1;
      if (threadFirstMutation[tm.threadId] === undefined) threadFirstMutation[tm.threadId] = idx;
    }
  });
  const totalScenes = keysUpToCurrent.length;

  const threads = branchThreads
    .map((t) => {
      const firstMut = threadFirstMutation[t.id];
      const age = firstMut !== undefined ? totalScenes - firstMut : 0;
      const mutations = threadMutationCount[t.id] ?? 0;
      const participantNames = t.participants.map((a) => n.characters[a.id]?.name ?? n.locations[a.id]?.name ?? a.id).join(', ');
      const validDeps = t.dependents.filter((id) => n.threads[id]);
      const depsAttr = validDeps.length > 0 ? ` converges="${validDeps.join(',')}"` : '';
      // Use timeline-scoped status, falling back to base status if no mutations yet
      const status = timelineState.threadStatuses[t.id] ?? t.status;
      return `<thread id="${t.id}" status="${status}"${age > 0 ? ` age="${age}" mutations="${mutations}"` : ''}${participantNames ? ` participants="${participantNames}"` : ''}${depsAttr}>${t.description}</thread>`;
    })
    .join('\n');
  const relationships = branchRelationships
    .map((r) => {
      const fromName = n.characters[r.from]?.name ?? r.from;
      const toName = n.characters[r.to]?.name ?? r.to;
      return `<relationship from="${fromName}" to="${toName}" valence="${Math.round(r.valence * 100) / 100}">${r.type}</relationship>`;
    })
    .join('\n');
  // All scenes within the time horizon get full mutation detail
  const sceneHistory = keysUpToCurrent.map((k, i) => {
    const s = resolveEntry(n, k);
    if (!s) return '';
    const globalIdx = horizonStart + i + 1;
    if (s.kind === 'world_build') {
      return `<entry index="${globalIdx}" type="world-build">${s.summary}</entry>`;
    }
    const loc = n.locations[s.locationId]?.name ?? s.locationId;
    const participants = s.participantIds.map((pid) => n.characters[pid]?.name ?? pid).join(', ');
    const threadChanges = s.threadMutations.map((tm) => {
      const thr = n.threads[tm.threadId];
      const desc = thr ? thr.description : tm.threadId;
      return `${desc}: ${tm.from}->${tm.to}`;
    }).join('; ');
    const continuityChanges = s.continuityMutations.flatMap((km) => {
      const entityName = n.characters[km.entityId]?.name ?? n.locations[km.entityId]?.name ?? n.artifacts[km.entityId]?.name ?? km.entityId;
      return (km.addedNodes ?? []).map(node => `${entityName} learned [${node.type}]: ${node.content}`);
    }).join('; ');
    const relChanges = s.relationshipMutations.map((rm) => {
      const fromName = n.characters[rm.from]?.name ?? rm.from;
      const toName = n.characters[rm.to]?.name ?? rm.to;
      return `${fromName}->${toName}: ${rm.type} (${rm.valenceDelta >= 0 ? '+' : ''}${Math.round(rm.valenceDelta * 100) / 100})`;
    }).join('; ');
    const ownershipChanges = (s.ownershipMutations ?? []).map((om) => {
      const artName = n.artifacts?.[om.artifactId]?.name ?? om.artifactId;
      const fromName = n.characters[om.fromId]?.name ?? n.locations[om.fromId]?.name ?? om.fromId;
      const toName = n.characters[om.toId]?.name ?? n.locations[om.toId]?.name ?? om.toId;
      return `${artName}: ${fromName}→${toName}`;
    }).join('; ');
    const artifactUsages = (s.artifactUsages ?? []).map((au) => {
      const artName = n.artifacts?.[au.artifactId]?.name ?? au.artifactId;
      const usageDesc = au.usage ? ` (${au.usage})` : '';
      if (!au.characterId) return `${artName} used${usageDesc}`;
      const charName = n.characters[au.characterId]?.name ?? au.characterId;
      return `${charName} uses ${artName}${usageDesc}`;
    }).join('; ');
    const tieChanges = (s.tieMutations ?? []).map((mm) => {
      const locName = n.locations[mm.locationId]?.name ?? mm.locationId;
      const charName = n.characters[mm.characterId]?.name ?? mm.characterId;
      return `${charName} ${mm.action === 'add' ? 'joins' : 'leaves'} ${locName}`;
    }).join('; ');
    const povName = n.characters[s.povId]?.name ?? s.povId;
    return `<entry index="${globalIdx}" location="${loc}" pov="${povName}" participants="${participants}"${threadChanges ? ` threads="${threadChanges}"` : ''}${continuityChanges ? ` continuity="${continuityChanges}"` : ''}${relChanges ? ` relationships="${relChanges}"` : ''}${ownershipChanges ? ` artifact-transfers="${ownershipChanges}"` : ''}${artifactUsages ? ` artifact-usages="${artifactUsages}"` : ''}${tieChanges ? ` ties="${tieChanges}"` : ''}>${s.summary}</entry>`;
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

  // Force trajectory — computed from all scenes for correct normalization,
  // but only the time horizon is included in the output
  const allScenes = keysUpToCurrent
    .map((k) => resolveEntry(n, k))
    .filter((e): e is Scene => e?.kind === 'scene');
  const forceMap = computeForceSnapshots(allScenes);
  const forceSnapshots = allScenes.map((s) => forceMap[s.id] ?? { payoff: 0, change: 0, knowledge: 0 });
  const swings = computeSwingMagnitudes(forceSnapshots);
  const payoffMA = movingAverage(forceSnapshots.map(f => f.payoff), FORCE_WINDOW_SIZE);
  const changeMA = movingAverage(forceSnapshots.map(f => f.change), FORCE_WINDOW_SIZE);
  const knowledgeMA = movingAverage(forceSnapshots.map(f => f.knowledge), FORCE_WINDOW_SIZE);
  const swingMA = movingAverage(swings, FORCE_WINDOW_SIZE);
  const forceTrajectory = allScenes.map((s, i) => {
    const f = forceMap[s.id];
    if (!f) return null;
    const corner = detectCubeCorner(f);
    return `[${horizonStart + i + 1}] P:${f.payoff >= 0 ? '+' : ''}${f.payoff.toFixed(1)} C:${f.change >= 0 ? '+' : ''}${f.change.toFixed(1)} K:${f.knowledge >= 0 ? '+' : ''}${f.knowledge.toFixed(1)} Sw:${swings[i].toFixed(1)} MA(P:${payoffMA[i].toFixed(1)} C:${changeMA[i].toFixed(1)} K:${knowledgeMA[i].toFixed(1)} Sw:${swingMA[i].toFixed(1)}) (${corner.name})`;
  }).filter(Boolean).join('\n');

  // Current cube position and local delivery position
  const currentForces = allScenes.length > 0 ? forceMap[allScenes[allScenes.length - 1].id] : null;
  const currentCube = currentForces ? detectCubeCorner(currentForces) : null;
  const windowScenes = allScenes.slice(-FORCE_WINDOW_SIZE);
  const windowMap = computeForceSnapshots(windowScenes);
  const windowOrdered = windowScenes.map((s) => windowMap[s.id]).filter(Boolean);
  const engPts = computeDeliveryCurve(windowOrdered);
  const localPos = engPts.length > 0 ? classifyCurrentPosition(engPts) : null;
  const currentStateBlock = currentCube
    ? `\n<current-state cube="${currentCube.name}" delivery="${localPos?.name ?? 'Stable'}">${currentCube.description}. ${localPos?.description ?? ''}</current-state>\n`
    : '';

  // ── World Knowledge Graph (scoped to time horizon) ─────────────────
  const horizonWorldKnowledge = buildCumulativeWorldKnowledge(
    n.scenes, keysUpToCurrent, keysUpToCurrent.length - 1, n.worldBuilds,
  );
  const rankedWorldNodes = rankWorldKnowledgeNodes(horizonWorldKnowledge);
  let worldKnowledgeBlock = '';
  if (rankedWorldNodes.length > 0) {
    // Build adjacency map for each node → connected concepts
    const adjacency = new Map<string, string[]>();
    for (const e of horizonWorldKnowledge.edges) {
      const fromConcept = horizonWorldKnowledge.nodes[e.from]?.concept;
      const toConcept = horizonWorldKnowledge.nodes[e.to]?.concept;
      if (!fromConcept || !toConcept) continue;
      adjacency.set(e.from, [...(adjacency.get(e.from) ?? []), toConcept]);
      adjacency.set(e.to, [...(adjacency.get(e.to) ?? []), fromConcept]);
    }

    // Show each node with its type and relationships
    const nodeLines = rankedWorldNodes.map(({ node }) => {
      const connections = adjacency.get(node.id);
      const connStr = connections && connections.length > 0
        ? ` ↔ ${connections.join(', ')}`
        : '';
      return `  [${node.type}] ${node.concept}${connStr}`;
    });

    const totalNodes = Object.keys(horizonWorldKnowledge.nodes).length;
    const totalEdges = horizonWorldKnowledge.edges.length;
    worldKnowledgeBlock = `
<world-knowledge nodes="${totalNodes}" edges="${totalEdges}" hint="Established rules, systems, concepts, tensions. Reference existing nodes when relevant. New nodes need edges showing how they relate.">

${nodeLines.join('\n')}
<node-ids>${rankedWorldNodes.map(({ node }) => `${node.id}: ${node.concept}`).join(', ')}</node-ids>
</world-knowledge>
`;
  }

  // Compact ID lookup — placed last so it's closest to the generation prompt
  const charIdList = branchCharacters.map((c) => c.id).join(', ');
  const locIdList = branchLocations.map((l) => l.id).join(', ');
  const threadIdList = branchThreads.map((t) => t.id).join(', ');

  const rulesBlock = n.rules && n.rules.length > 0
    ? `\n<world-rules hint="Absolute constraints — every scene MUST obey these.">\n${n.rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n</world-rules>\n`
    : '';

  const systemsBlock = buildWorldSystemsBlock(n.worldSystems);

  const storySettingsBlock = buildStorySettingsBlock(n);

  const historyNote = skippedCount > 0
    ? `${keysUpToCurrent.length} scenes in time horizon, ${skippedCount} earlier omitted`
    : `${keysUpToCurrent.length} scenes on current branch`;

  return `<narrative title="${n.title}">
<world>${n.worldSummary}</world>
${rulesBlock}${systemsBlock}${storySettingsBlock}
<characters hint="Continuity tracks what each character knows. Use this to determine what they can reference, discover, or be surprised by.">
${characters}
</characters>

<locations hint="Nested via parent attribute. Characters must physically travel between locations — no teleportation.">
${locations}
</locations>

<threads hint="Lifecycle: dormant → active → escalating → critical → resolved/subverted/abandoned. Advance through action. Threads sharing participants should collide.">
${threads}
</threads>

<relationships hint="Valence: negative = hostile/tense, positive = warm/allied. All interactions must reflect the current valence. Shifts happen through dramatic moments, not narration.">
${relationships}
</relationships>

<arcs hint="Each arc develops specific threads. New arcs should continue momentum from previous ones.">
${arcs}
</arcs>

<scene-history scope="${historyNote}" hint="Full mutation detail for recent scenes. Check this before writing to avoid repeating beats, locations, or character patterns.">
${sceneHistory}
</scene-history>

<force-trajectory hint="P=Payoff C=Change K=Knowledge. Use this to gauge pacing rhythm — vary density between scenes.">
${forceTrajectory || '(no scenes yet)'}
${currentStateBlock}</force-trajectory>
${worldKnowledgeBlock}${buildDramaticIronyBlock(n, keysUpToCurrent)}
<valid-ids hint="You MUST use ONLY these exact IDs — do NOT invent new ones.">
  <characters>${charIdList}</characters>
  <locations>${locIdList}</locations>
  <threads>${threadIdList}</threads>${artifactEntries.length > 0 ? `\n  <artifacts>${artifactEntries.map((a) => a.id).join(', ')}</artifacts>` : ''}
</valid-ids>
</narrative>`;
}

export function sceneContext(
  narrative: NarrativeState,
  scene: Scene,
  resolvedKeys?: string[],
  currentIndex?: number,
): string {
  const location = narrative.locations[scene.locationId];
  const pov = narrative.characters[scene.povId];
  const participants = scene.participantIds.map((pid) => narrative.characters[pid]).filter(Boolean);
  const arc = Object.values(narrative.arcs).find((a) => a.sceneIds.includes(scene.id));
  const participantIdSet = new Set(scene.participantIds);

  // Get timeline-scoped state when resolvedKeys and currentIndex are provided
  const timelineState = resolvedKeys && currentIndex !== undefined
    ? getStateAtIndex(narrative, resolvedKeys, currentIndex)
    : null;

  // ── Characters: knowledge scoped to timeline when available ──────────
  const RECENT_CONTINUITY = SCENE_CONTEXT_RECENT_CONTINUITY;

  const characterBlocks = participants.map((p) => {
    // Filter to nodes that existed at this point in the timeline
    const allNodes = Object.values(p.continuity.nodes);
    const scopedNodes = timelineState
      ? allNodes.filter((kn) => timelineState.liveNodeIds.has(kn.id))
      : allNodes;
    const recentNodes = scopedNodes.slice(-RECENT_CONTINUITY);
    const omitted = scopedNodes.length - recentNodes.length;
    const knLines = recentNodes.map((kn) => `    <knowledge type="${kn.type}">${kn.content}</knowledge>`);
    const knBlock = knLines.length > 0 ? `\n${knLines.join('\n')}` : '';
    return `  <character id="${p.id}" name="${p.name}" role="${p.role}"${omitted > 0 ? ` omitted="${omitted}"` : ''}>${knBlock}\n  </character>`;
  });

  // ── Location: continuity scoped to timeline when available ────────────────────────────────────
  const locationBlock = (() => {
    if (!location) return '<location name="Unknown" />';
    const allLocNodes = Object.values(location.continuity.nodes);
    const scopedNodes = timelineState
      ? allLocNodes.filter((kn) => timelineState.liveNodeIds.has(kn.id))
      : allLocNodes;
    const recentNodes = scopedNodes.slice(-RECENT_CONTINUITY);
    const knLines = recentNodes.map((kn) => `    <knowledge type="${kn.type}">${kn.content}</knowledge>`);
    const parent = location.parentId ? ` parent="${narrative.locations[location.parentId]?.name ?? location.parentId}"` : '';
    const tiedNames = (location.tiedCharacterIds ?? []).map(id => narrative.characters[id]?.name).filter(Boolean);
    const tiesAttr = tiedNames.length > 0 ? ` ties="${tiedNames.join(', ')}"` : '';
    const knBlock = knLines.length > 0 ? `\n${knLines.join('\n')}` : '';
    return `  <location id="${location.id}" name="${location.name}"${parent}${tiesAttr}>${knBlock}\n  </location>`;
  })();

  // ── Relationships between participants (scoped to timeline when available) ─────────────────────────────
  const baseRelationships = timelineState?.relationships ?? narrative.relationships;
  const relevantRelationships = baseRelationships.filter(
    (r) => participantIdSet.has(r.from) && participantIdSet.has(r.to),
  );
  const relationshipStateLines = relevantRelationships.map((r) => {
    const fromName = narrative.characters[r.from]?.name ?? r.from;
    const toName = narrative.characters[r.to]?.name ?? r.to;
    return `  <relationship from="${fromName}" to="${toName}" valence="${Math.round(r.valence * 100) / 100}">${r.type}</relationship>`;
  });

  // ── Threads involved in this scene (status scoped to timeline when available) ─────────────────────────────────
  const threadIds = new Set(scene.threadMutations.map((tm) => tm.threadId));
  const threadBlocks = [...threadIds].map((tid) => {
    const thread = narrative.threads[tid];
    if (!thread) return `  <thread id="${tid}">unknown</thread>`;
    const tParticipants = thread.participants.map((a) => {
      if (a.type === 'character') return narrative.characters[a.id]?.name ?? a.id;
      if (a.type === 'location') return narrative.locations[a.id]?.name ?? a.id;
      return a.id;
    });
    const status = timelineState?.threadStatuses[tid] ?? thread.status;
    return `  <thread id="${tid}" status="${status}" participants="${tParticipants.join(', ')}">${thread.description}</thread>`;
  });

  // ── Scene mutations ────────────────────────────────────────────────
  const threadMutationLines = scene.threadMutations.map((tm) => {
    const thread = narrative.threads[tm.threadId];
    return `  <shift thread="${thread?.description ?? tm.threadId}" from="${tm.from}" to="${tm.to}" />`;
  });

  const continuityMutationLines = scene.continuityMutations.flatMap((km) => {
    const entityName = narrative.characters[km.entityId]?.name ?? narrative.locations[km.entityId]?.name ?? narrative.artifacts[km.entityId]?.name ?? km.entityId;
    const nodeLines = (km.addedNodes ?? []).map(node => `  <change entity="${entityName}" type="${node.type}">${node.content}</change>`);
    const edgeLines = (km.addedEdges ?? []).map(edge => `  <edge entity="${entityName}" from="${edge.from}" to="${edge.to}" relation="${edge.relation}" />`);
    return [...nodeLines, ...edgeLines];
  });

  const relationshipMutationLines = scene.relationshipMutations.map((rm) => {
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

  const ownershipMutationLines = (scene.ownershipMutations ?? []).map((om) => {
    const artName = narrative.artifacts?.[om.artifactId]?.name ?? om.artifactId;
    const fromName = narrative.characters[om.fromId]?.name ?? narrative.locations[om.fromId]?.name ?? om.fromId;
    const toName = narrative.characters[om.toId]?.name ?? narrative.locations[om.toId]?.name ?? om.toId;
    return `  <transfer artifact="${artName}" from="${fromName}" to="${toName}" />`;
  });

  const tieMutationLines = (scene.tieMutations ?? []).map((mm) => {
    const locName = narrative.locations[mm.locationId]?.name ?? mm.locationId;
    const charName = narrative.characters[mm.characterId]?.name ?? mm.characterId;
    return `  <tie character="${charName}" action="${mm.action}" location="${locName}" />`;
  });

  const wkmBlock = (() => {
    const wkm = scene.worldKnowledgeMutations;
    if (!wkm || ((wkm.addedNodes?.length ?? 0) === 0 && (wkm.addedEdges?.length ?? 0) === 0)) return '';
    const lines: string[] = [];
    for (const node of wkm.addedNodes ?? []) {
      lines.push(`  <node type="${node.type}">${node.concept}</node>`);
    }
    for (const edge of wkm.addedEdges ?? []) {
      const fromLabel = narrative.worldKnowledge.nodes[edge.from]?.concept ?? edge.from;
      const toLabel = narrative.worldKnowledge.nodes[edge.to]?.concept ?? edge.to;
      lines.push(`  <edge>${fromLabel} → ${edge.relation} → ${toLabel}</edge>`);
    }
    return `\n<world-knowledge-reveals>\n${lines.join('\n')}\n</world-knowledge-reveals>`;
  })();

  // ── World rules & systems (compact) ──────────────────────────────
  const rulesBlock = narrative.rules?.length
    ? `\n<world-rules>\n${narrative.rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n</world-rules>` : '';
  const systemsBlock = buildWorldSystemsBlock(narrative.worldSystems);

  return `<scene id="${scene.id}" arc="${arc?.name ?? 'standalone'}" pov="${pov?.name ?? 'Unknown'}" pov-role="${pov?.role ?? 'unknown'}">
<summary>${scene.summary}</summary>

<characters>
${characterBlocks.join('\n')}
</characters>

<location>
${locationBlock}
</location>
${relationshipStateLines.length > 0 ? `\n<relationships>\n${relationshipStateLines.join('\n')}\n</relationships>` : ''}
${threadBlocks.length > 0 ? `\n<threads>\n${threadBlocks.join('\n')}\n</threads>` : ''}

<events>
${scene.events.map((e) => `  <event>${e}</event>`).join('\n')}
</events>
${threadMutationLines.length > 0 ? `\n<thread-shifts>\n${threadMutationLines.join('\n')}\n</thread-shifts>` : ''}
${continuityMutationLines.length > 0 ? `\n<continuity-changes>\n${continuityMutationLines.join('\n')}\n</continuity-changes>` : ''}
${relationshipMutationLines.length > 0 ? `\n<relationship-shifts>\n${relationshipMutationLines.join('\n')}\n</relationship-shifts>` : ''}${wkmBlock}
${movementLines.length > 0 ? `\n<movements>\n${movementLines.join('\n')}\n</movements>` : ''}
${artifactUsageLines.length > 0 ? `\n<artifact-usages>\n${artifactUsageLines.join('\n')}\n</artifact-usages>` : ''}
${ownershipMutationLines.length > 0 ? `\n<artifact-transfers>\n${ownershipMutationLines.join('\n')}\n</artifact-transfers>` : ''}
${tieMutationLines.length > 0 ? `\n<tie-changes>\n${tieMutationLines.join('\n')}\n</tie-changes>` : ''}${rulesBlock}${systemsBlock}
</scene>`;
}

/** Scene scale based on standard: ~10 beats × ~100 words/beat = ~1000 words.
 *  Generation is flexible — the LLM can vary beat count based on scene intensity. */
export function sceneScale(scene: Scene): { estWords: number; targetBeats: number; planWords: string } {
  return { estWords: WORDS_PER_SCENE, targetBeats: BEATS_PER_SCENE, planWords: `${Math.round(WORDS_PER_SCENE * 0.3)}-${Math.round(WORDS_PER_SCENE * 0.5)}` };
}

/**
 * Compute dramatic irony: what the reader knows that key characters don't.
 *
 * The reader "participates" in every scene. Characters only know what happened
 * in scenes they were present for. The gap is dramatic irony — the engine of
 * suspense, dread, and dramatic satisfaction.
 *
 * Returns a formatted block for injection into branchContext.
 */
function buildDramaticIronyBlock(n: NarrativeState, resolvedKeys: string[]): string {
  const anchors = Object.values(n.characters).filter((c) => c.role === 'anchor');
  if (anchors.length === 0 || resolvedKeys.length < 3) return '';

  // Build per-character knowledge: what continuity nodes exist in scenes they participated in
  const charSceneKnowledge = new Map<string, Set<string>>();
  // Reader knowledge: all continuity across all scenes
  const readerKnowledge = new Map<string, { charName: string; content: string; sceneIdx: number }>();

  resolvedKeys.forEach((key, idx) => {
    const scene = n.scenes[key];
    if (!scene) return;

    // Track what each entity learns from this scene
    for (const km of scene.continuityMutations) {
      for (const node of km.addedNodes ?? []) {
        const nodeKey = `${km.entityId}:${node.id}`;

        // Reader sees everything
        const entityName = n.characters[km.entityId]?.name ?? n.locations[km.entityId]?.name ?? n.artifacts[km.entityId]?.name ?? km.entityId;
        if (!readerKnowledge.has(nodeKey)) {
          readerKnowledge.set(nodeKey, { charName: entityName, content: node.content, sceneIdx: idx + 1 });
        }

        // Characters only see scenes they're in
        for (const pid of scene.participantIds) {
          if (!charSceneKnowledge.has(pid)) charSceneKnowledge.set(pid, new Set());
          charSceneKnowledge.get(pid)!.add(nodeKey);
        }

        // Also the entity that learns it directly
        if (!charSceneKnowledge.has(km.entityId)) charSceneKnowledge.set(km.entityId, new Set());
        charSceneKnowledge.get(km.entityId)!.add(nodeKey);
      }
    }
  });

  // Find the most dramatically useful gaps for each anchor
  const ironyLines: string[] = [];

  for (const anchor of anchors) {
    const anchorKnows = charSceneKnowledge.get(anchor.id) ?? new Set<string>();

    // What does the reader know about OTHER characters that this anchor doesn't?
    const gaps: { charName: string; content: string; sceneIdx: number }[] = [];
    for (const [nodeKey, info] of readerKnowledge) {
      if (!anchorKnows.has(nodeKey) && info.charName !== anchor.name) {
        gaps.push(info);
      }
    }

    if (gaps.length === 0) continue;

    // Take the most recent gaps (most dramatically relevant)
    const recent = gaps.sort((a, b) => b.sceneIdx - a.sceneIdx).slice(0, 3);
    const gapDescs = recent.map((g) => `${g.charName} learned "${g.content}" (scene ${g.sceneIdx})`);
    ironyLines.push(`${anchor.name} is UNAWARE that: ${gapDescs.join('; ')}`);
  }

  if (ironyLines.length === 0) return '';

  return `\n<dramatic-irony hint="The reader knows these things but the characters do not. Exploit these gaps — scenes where characters act on incomplete information create tension.">\n${ironyLines.join('\n')}\n</dramatic-irony>\n`;
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
    const allCharNodes = Object.values(char.continuity.nodes);
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
  // Logic context focuses on scene-specific knowledge boundaries and mutations.

  // ═══════════════════════════════════════════════════════════════════════════
  // KNOWLEDGE STATE (POV's knowledge at scene start vs. what they learn)
  // ═══════════════════════════════════════════════════════════════════════════
  if (pov) {
    const povKnowledge = getCharacterKnowledge(pov.id);
    // Knowledge being added to POV this scene — they don't have it at the START
    const povLearnsNodes = scene.continuityMutations
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
    for (const km of scene.continuityMutations) {
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
      scene.continuityMutations
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

    // Dramatic irony: things the reader knows that POV doesn't (from other scenes)
    const dramaticIronyItems: string[] = [];
    for (const [, char] of Object.entries(narrative.characters)) {
      if (char.id === pov.id) continue;
      const charKnowledge = getCharacterKnowledge(char.id);
      for (const kn of charKnowledge) {
        if (!povKnowledgeIds.has(kn.id) && !povLearnsNodeIds.has(kn.id)) {
          const anyParticipantKnows = scene.participantIds.some((pid) => {
            if (pid === pov.id) return false;
            const pKnowledge = getCharacterKnowledge(pid);
            return pKnowledge.some((n) => n.id === kn.id);
          });
          if (anyParticipantKnows) {
            dramaticIronyItems.push(`${kn.content} (${char.name})`);
          }
        }
      }
    }

    if (asymmetryLines.length > 0 || dramaticIronyItems.length > 0) {
      const ironyBlock = dramaticIronyItems.length > 0
        ? `\n  <dramatic-irony hint="Reader knows these, POV does not — show POV acting on incomplete information">${dramaticIronyItems.join(' | ')}</dramatic-irony>`
        : '';
      sections.push(`<knowledge-asymmetry pov="${pov.name}">
${asymmetryLines.join('\n')}${ironyBlock}
  <constraint>Do not reveal hidden knowledge through narration. ${pov.name} can only observe external behaviour and draw their own (possibly wrong) conclusions.</constraint>
</knowledge-asymmetry>`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // THREAD TRANSITIONS
  // ═══════════════════════════════════════════════════════════════════════════
  if (scene.threadMutations.length > 0) {
    const threadLines = scene.threadMutations.map((tm) => {
      const thread = narrative.threads[tm.threadId];
      const desc = thread?.description ?? tm.threadId;
      return `  <thread name="${desc}" from="${tm.from}" to="${tm.to}" />`;
    });
    sections.push(`<threads hint="Each thread begins in its 'from' state and must transition to its 'to' state during the scene">
${threadLines.join('\n')}
</threads>`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RELATIONSHIPS (static state + mutations)
  // ═══════════════════════════════════════════════════════════════════════════
  const baseRelationships = timelineState?.relationships ?? narrative.relationships;
  const participantRelationships = baseRelationships.filter(
    (r) => participantIdSet.has(r.from) && participantIdSet.has(r.to),
  );

  // Compute pre-scene valence by subtracting this scene's deltas
  const mutationDeltaMap = new Map<string, number>();
  for (const rm of scene.relationshipMutations) {
    const key = `${rm.from}->${rm.to}`;
    mutationDeltaMap.set(key, (mutationDeltaMap.get(key) ?? 0) + rm.valenceDelta);
  }

  const relationshipLines: string[] = [];

  // Static relationships (no mutation this scene) that are notably negative
  for (const r of participantRelationships) {
    const fromName = narrative.characters[r.from]?.name;
    const toName = narrative.characters[r.to]?.name;
    if (!fromName || !toName) continue;

    const key = `${r.from}->${r.to}`;
    const delta = mutationDeltaMap.get(key) ?? 0;
    if (delta !== 0) continue; // handled below in shifts

    const preSceneValence = Math.round((r.valence - delta) * 100) / 100;
    if (preSceneValence <= -0.5) {
      relationshipLines.push(`  <state from="${fromName}" to="${toName}" valence="${preSceneValence}" tone="hostile">${r.type}</state>`);
    } else if (preSceneValence <= -0.1) {
      relationshipLines.push(`  <state from="${fromName}" to="${toName}" valence="${preSceneValence}" tone="tense">${r.type}</state>`);
    }
  }

  // Relationship mutations
  for (const rm of scene.relationshipMutations) {
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
    sections.push(`<relationships hint="Interactions must reflect these valences. Shifts must be dramatised through behaviour, dialogue, or action.">
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
  if (scene.worldKnowledgeMutations) {
    const wkm = scene.worldKnowledgeMutations;
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
      const fromNode = narrative.worldKnowledge?.nodes[edge.from] ?? wkm.addedNodes?.find((n) => n.id === edge.from);
      const toNode = narrative.worldKnowledge?.nodes[edge.to] ?? wkm.addedNodes?.find((n) => n.id === edge.to);
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
      if (!newNodeIds.has(edge.from) && narrative.worldKnowledge?.nodes[edge.from]) referencedExistingIds.add(edge.from);
      if (!newNodeIds.has(edge.to) && narrative.worldKnowledge?.nodes[edge.to]) referencedExistingIds.add(edge.to);
    }
    if (referencedExistingIds.size > 0) {
      const established = [...referencedExistingIds].map((id) => {
        const node = narrative.worldKnowledge.nodes[id];
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
  const getArtifactCapabilities = (a: { continuity: { nodes: Record<string, { id: string; content: string }> } }) => {
    const allArtNodes = Object.values(a.continuity.nodes);
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
  for (const om of scene.ownershipMutations ?? []) {
    const art = artifacts[om.artifactId];
    if (!art) continue;
    const fromName = narrative.characters[om.fromId]?.name ?? narrative.locations[om.fromId]?.name ?? om.fromId;
    const toName = narrative.characters[om.toId]?.name ?? narrative.locations[om.toId]?.name ?? om.toId;
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
 * Formatted logic context for LLM prompts — delegates to deriveLogicRules which returns structured XML.
 * Returns empty string if no rules apply.
 */
export function logicContext(
  narrative: NarrativeState,
  scene: Scene,
  resolvedKeys: string[],
  currentIndex: number,
): string {
  return deriveLogicRules(narrative, scene, resolvedKeys, currentIndex);
}

/**
 * Summary context — a condensed running summary of the story up to the current scene.
 * Shows scene summaries grouped by arc with POV, location, and key thread activity.
 * Much lighter than branchContext — designed for quick orientation without full mutation detail.
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
    const threadChanges = entry.threadMutations
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

/**
 * World context — cumulative state of the world up to a given timeline index,
 * organised by world build commits so the LLM can see when each part was introduced.
 */
export function worldContext(
  n: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): string {
  const keysUpToCurrent = resolvedKeys.slice(0, currentIndex + 1);

  // Replay thread status up to this point
  const threadStatusAtPoint: Record<string, string> = {};
  for (const k of keysUpToCurrent) {
    const entry = resolveEntry(n, k);
    if (entry?.kind !== 'scene') continue;
    for (const tm of entry.threadMutations) threadStatusAtPoint[tm.threadId] = tm.to;
  }

  // Replay continuity mutations up to this point to know which nodes are live (additive)
  const liveNodeIds = new Set<string>();
  for (const k of keysUpToCurrent) {
    const entry = resolveEntry(n, k);
    if (entry?.kind !== 'scene') continue;
    for (const km of entry.continuityMutations) {
      for (const node of km.addedNodes ?? []) liveNodeIds.add(node.id);
    }
  }

  // Find world build commits up to current index (in order)
  const wxKeys = keysUpToCurrent.filter((k) => n.worldBuilds[k]);

  // Build each commit section
  const commitSections = wxKeys.map((wxKey) => {
    const wb = n.worldBuilds[wxKey];
    const { characters: manifestChars, locations: manifestLocs, threads: manifestThreads } = wb.expansionManifest;

    const charLines = manifestChars
      .map((mc) => {
        const c = n.characters[mc.id];
        if (!c) return null;
        const nodes = Object.values(c.continuity.nodes).filter((kn) => liveNodeIds.has(kn.id));
        const knBlock = nodes.length > 0 ? `\n${nodes.map((kn) => `    <knowledge type="${kn.type}">${kn.content}</knowledge>`).join('\n')}` : '';
        return `  <character id="${mc.id}" name="${c.name}" role="${c.role}">${knBlock}\n  </character>`;
      })
      .filter(Boolean)
      .join('\n');

    const locLines = manifestLocs
      .map((ml) => {
        const l = n.locations[ml.id];
        if (!l) return null;
        const parent = l.parentId ? ` parent="${n.locations[l.parentId]?.name ?? l.parentId}"` : '';
        const nodes = Object.values(l.continuity.nodes).filter((kn) => liveNodeIds.has(kn.id));
        const loreBlock = nodes.length > 0 ? `\n${nodes.map((kn) => `    <knowledge>${kn.content}</knowledge>`).join('\n')}` : '';
        return `  <location id="${ml.id}" name="${l.name}"${parent}>${loreBlock}\n  </location>`;
      })
      .filter(Boolean)
      .join('\n');

    const threadLines = manifestThreads
      .map((mt) => {
        const t = n.threads[mt.id];
        if (!t) return null;
        const status = threadStatusAtPoint[mt.id] ?? t.status;
        const participantNames = t.participants
          .map((a) => n.characters[a.id]?.name ?? n.locations[a.id]?.name ?? a.id)
          .join(', ');
        return `  <thread id="${mt.id}" status="${status}" participants="${participantNames}">${t.description}</thread>`;
      })
      .filter(Boolean)
      .join('\n');

    const parts: string[] = [
      `<world-commit id="${wxKey}">`,
      `<summary>${wb.summary}</summary>`,
      charLines ? `<characters>\n${charLines}\n</characters>` : '',
      locLines ? `<locations>\n${locLines}\n</locations>` : '',
      threadLines ? `<threads>\n${threadLines}\n</threads>` : '',
      `</world-commit>`,
    ].filter(Boolean);
    return parts.join('\n');
  });

  // Cumulative world knowledge graph up to this point
  const wk = buildCumulativeWorldKnowledge(n.scenes, keysUpToCurrent, keysUpToCurrent.length - 1, n.worldBuilds);
  const rankedNodes = rankWorldKnowledgeNodes(wk);
  let wkBlock = '';
  if (rankedNodes.length > 0) {
    const adjacency = new Map<string, string[]>();
    for (const e of wk.edges) {
      const fc = wk.nodes[e.from]?.concept;
      const tc = wk.nodes[e.to]?.concept;
      if (!fc || !tc) continue;
      adjacency.set(e.from, [...(adjacency.get(e.from) ?? []), tc]);
      adjacency.set(e.to, [...(adjacency.get(e.to) ?? []), fc]);
    }
    const nodeLines = rankedNodes.map(({ node }) => {
      const conns = adjacency.get(node.id);
      return `  [${node.type}] ${node.concept}${conns?.length ? ` ↔ ${conns.join(', ')}` : ''}`;
    });
    wkBlock = `\n<world-knowledge nodes="${rankedNodes.length}" edges="${wk.edges.length}">\n${nodeLines.join('\n')}\n</world-knowledge>\n`;
  }

  const rulesBlock = n.rules?.length
    ? `<world-rules hint="Absolute constraints — every scene MUST obey these.">\n${n.rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n</world-rules>\n`
    : '';

  const systemsBlock = buildWorldSystemsBlock(n.worldSystems);

  const sceneCount = keysUpToCurrent.filter((k) => n.scenes[k]).length;

  return `<world-state title="${n.title}" scenes="${sceneCount}" commits="${wxKeys.length}">
<summary>${n.worldSummary ?? ''}</summary>
${rulesBlock}${systemsBlock}
<world-commits hint="Chronological — each commit shows what was introduced to the world.">
${commitSections.join('\n\n')}
</world-commits>
${wkBlock}</world-state>`;
}

