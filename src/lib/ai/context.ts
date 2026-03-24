import type { NarrativeState, Scene, StorySettings } from '@/types/narrative';
import { resolveEntry, THREAD_ACTIVE_STATUSES, THREAD_TERMINAL_STATUSES, THREAD_STATUS_LABELS, DEFAULT_STORY_SETTINGS } from '@/types/narrative';
import { computeForceSnapshots, computeSwingMagnitudes, detectCubeCorner, movingAverage, FORCE_WINDOW_SIZE, computeDeliveryCurve, classifyCurrentPosition, buildCumulativeWorldKnowledge, rankWorldKnowledgeNodes } from '@/lib/narrative-utils';
import { SCENE_CONTEXT_RECENT_CONTINUITY } from '@/lib/constants';

// Build thread lifecycle documentation from canonical status lists
export const THREAD_LIFECYCLE_DOC = (() => {
  const activeList = THREAD_ACTIVE_STATUSES.map((s) => `"${s}"`).join(', ');
  const terminalList = THREAD_TERMINAL_STATUSES.map(
    (s) => `"${s}" (${THREAD_STATUS_LABELS[s]})`,
  ).join(', ');
  return `Active statuses: ${activeList}. Terminal/closed statuses: ${terminalList}.`;
})();

/** Build a prompt block from story settings — returns empty string if all defaults */
export function buildStorySettingsBlock(n: NarrativeState): string {
  const s: StorySettings = { ...DEFAULT_STORY_SETTINGS, ...n.storySettings };
  const lines: string[] = [];

  // POV mode
  const povLabels: Record<string, string> = {
    single: 'SINGLE POV — every scene must use the same POV character.',
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
      lines.push(`Designated POV character${s.povCharacterIds.length > 1 ? 's' : ''}: ${names}. Only these characters may appear in the "povId" field.`);
    }
  }

  // Story direction
  if (s.storyDirection.trim()) {
    lines.push(`STORY DIRECTION (high-level north star): ${s.storyDirection.trim()}`);
  }

  if (lines.length === 0) return '';
  return `\nSTORY SETTINGS (these shape all generation — respect them):\n${lines.join('\n')}\n`;
}

export function branchContext(
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
        referencedCharIds.add(km.characterId);
        horizonContinuityNodeIds.add(km.nodeId);
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
  const branchRelationships = hasHistory
    ? n.relationships.filter((r) => referencedCharIds.has(r.from) && referencedCharIds.has(r.to))
    : n.relationships;

  // Collect all knowledge node IDs that were ever added via mutations (across full history)
  // so we can distinguish original/base nodes from mutation-added ones
  const allMutationNodeIds = new Set<string>();
  for (const k of allKeysUpToCurrent) {
    const entry = resolveEntry(n, k);
    if (entry?.kind === 'scene') {
      for (const km of entry.continuityMutations) allMutationNodeIds.add(km.nodeId);
    }
  }

  // Knowledge: keep original (non-mutation) nodes + mutation nodes from the time horizon
  const characters = branchCharacters
    .map((c) => {
      const relevantNodes = c.continuity.nodes
        .filter((kn) => !allMutationNodeIds.has(kn.id) || horizonContinuityNodeIds.has(kn.id));
      const continuityLines = relevantNodes.map((kn) => `    (${kn.type}) ${kn.content}`);
      const omitted = c.continuity.nodes.length - relevantNodes.length;
      const truncated = omitted > 0
        ? `\n  (${omitted} continuity items outside time horizon omitted)`
        : '';
      const continuityBlock = continuityLines.length > 0
        ? `\n  Continuity — what this character knows, has experienced, or possesses (${relevantNodes.length} in scope):${truncated}\n${continuityLines.join('\n')}`
        : '';
      return `- ${c.id}: ${c.name} (${c.role})${continuityBlock}`;
    })
    .join('\n');
  const locations = branchLocations
    .map((l) => {
      const continuityLines = l.continuity.nodes.map((kn) => `    (${kn.type}) ${kn.content}`);
      const continuityBlock = continuityLines.length > 0
        ? `\n  Continuity — established facts, conditions, and state of this place (${l.continuity.nodes.length}):\n${continuityLines.join('\n')}`
        : '';
      return `- ${l.id}: ${l.name}${l.parentId ? ` (inside ${n.locations[l.parentId]?.name ?? l.parentId})` : ''}${continuityBlock}`;
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
      const ageLabel = age > 0 ? `, active ${age} scenes, ${mutations} mutations` : '';
      return `- ${t.id}: ${t.description} [${t.status}${ageLabel}]`;
    })
    .join('\n');
  const relationships = branchRelationships
    .map((r) => {
      const fromName = n.characters[r.from]?.name ?? r.from;
      const toName = n.characters[r.to]?.name ?? r.to;
      return `- ${r.from} (${fromName}) -> ${r.to} (${toName}): ${r.type} (valence: ${Math.round(r.valence * 100) / 100})`;
    })
    .join('\n');

  // All scenes within the time horizon get full mutation detail
  const sceneHistory = keysUpToCurrent.map((k, i) => {
    const s = resolveEntry(n, k);
    if (!s) return '';
    const globalIdx = horizonStart + i + 1;
    if (s.kind === 'world_build') {
      return `[${globalIdx}] ${s.id} [WORLD BUILD]\n   ${s.summary}`;
    }
    const loc = `${s.locationId} (${n.locations[s.locationId]?.name ?? 'unknown'})`;
    const participants = s.participantIds.map((pid) => `${pid} (${n.characters[pid]?.name ?? 'unknown'})`).join(', ');
    const threadChanges = s.threadMutations.map((tm) => `${tm.threadId}: ${tm.from}->${tm.to}`).join('; ');
    const continuityChanges = s.continuityMutations.map((km) => `${km.characterId} learned [${km.nodeType}]: ${km.content}`).join('; ');
    const relChanges = s.relationshipMutations.map((rm) => {
      const fromName = n.characters[rm.from]?.name ?? rm.from;
      const toName = n.characters[rm.to]?.name ?? rm.to;
      return `${fromName}->${toName}: ${rm.type} (${rm.valenceDelta >= 0 ? '+' : ''}${Math.round(rm.valenceDelta * 100) / 100})`;
    }).join('; ');
    return `[${globalIdx}] ${s.id} @ ${loc} | ${participants}${threadChanges ? ` | Threads: ${threadChanges}` : ''}${continuityChanges ? ` | Continuity: ${continuityChanges}` : ''}${relChanges ? ` | Relationships: ${relChanges}` : ''}
   ${s.summary}`;
  }).filter(Boolean).join('\n');

  // Arcs context — only arcs with scenes within the time horizon
  const branchSceneIds = new Set(keysUpToCurrent.filter((k) => n.scenes[k]));
  const arcs = Object.values(n.arcs)
    .filter((a) => !hasHistory || a.sceneIds.some((sid) => branchSceneIds.has(sid)))
    .map((a) => `- ${a.id}: "${a.name}" (${a.sceneIds.length} scenes, develops: ${a.develops.join(', ')})`)
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
    ? `\nCURRENT NARRATIVE STATE:\n  Cube position: ${currentCube.name} (P:${currentForces!.payoff >= 0 ? 'Hi' : 'Lo'} C:${currentForces!.change >= 0 ? 'Hi' : 'Lo'} K:${currentForces!.knowledge >= 0 ? 'Hi' : 'Lo'}) — ${currentCube.description}\n  Delivery position: ${localPos?.name ?? 'Stable'} — ${localPos?.description ?? 'deliveries are holding steady'}\n`
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
    worldKnowledgeBlock = `\n────────────────────────────────────────
WORLD KNOWLEDGE GRAPH (${totalNodes} concepts, ${totalEdges} relationships):
The established rules, systems, concepts, and tensions of this world. Edges describe how concepts relate (enables, governs, opposes, etc.) — they make the world coherent. New scenes should reference existing concepts when relevant and add new ones with edges showing how they relate to what's established.

${nodeLines.join('\n')}

Existing world knowledge node IDs (use in addedEdges to show how new concepts relate to existing ones):
  ${rankedWorldNodes.map(({ node }) => `${node.id}: ${node.concept}`).join(', ')}
`;
  }

  // Compact ID lookup — placed last so it's closest to the generation prompt
  const charIdList = branchCharacters.map((c) => c.id).join(', ');
  const locIdList = branchLocations.map((l) => l.id).join(', ');
  const threadIdList = branchThreads.map((t) => t.id).join(', ');

  const rulesBlock = n.rules && n.rules.length > 0
    ? `\nWORLD RULES (these are absolute — every scene MUST obey them):\n${n.rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n`
    : '';

  const storySettingsBlock = buildStorySettingsBlock(n);

  const horizonLabel = skippedCount > 0
    ? `SCENE HISTORY (${keysUpToCurrent.length} scenes in time horizon, ${skippedCount} earlier scenes omitted):`
    : `SCENE HISTORY (${keysUpToCurrent.length} scenes on current branch):`;

  return `NARRATIVE: "${n.title}"
WORLD: ${n.worldSummary}
${rulesBlock}${storySettingsBlock}
────────────────────────────────────────
CHARACTERS:
${characters}

────────────────────────────────────────
LOCATIONS:
${locations}

────────────────────────────────────────
THREADS:
${threads}

────────────────────────────────────────
RELATIONSHIPS:
${relationships}

────────────────────────────────────────
ARCS:
${arcs}

────────────────────────────────────────
${horizonLabel}
${sceneHistory}

────────────────────────────────────────
FORCE TRAJECTORY (computed from scene structure — shows pacing rhythm):
${forceTrajectory || '(no scenes yet)'}
${currentStateBlock}${worldKnowledgeBlock}────────────────────────────────────────
VALID IDs (you MUST use ONLY these exact IDs — do NOT invent new ones):
  Character IDs: ${charIdList}
  Location IDs: ${locIdList}
  Thread IDs: ${threadIdList}`;
}

export function sceneContext(narrative: NarrativeState, scene: Scene): string {
  const location = narrative.locations[scene.locationId];
  const pov = narrative.characters[scene.povId];
  const participants = scene.participantIds.map((pid) => narrative.characters[pid]).filter(Boolean);
  const arc = Object.values(narrative.arcs).find((a) => a.sceneIds.includes(scene.id));
  const participantIdSet = new Set(scene.participantIds);

  // ── Characters: full knowledge graph for each participant ──────────
  const RECENT_CONTINUITY = SCENE_CONTEXT_RECENT_CONTINUITY;

  const characterBlocks = participants.map((p) => {
    const recentNodes = p.continuity.nodes.slice(-RECENT_CONTINUITY);
    const omitted = p.continuity.nodes.length - recentNodes.length;
    const knLines = recentNodes.map((kn) => `    (${kn.type}) ${kn.content}`);
    const omittedNote = omitted > 0 ? `\n    (${omitted} earlier items omitted)` : '';
    const knBlock = knLines.length > 0
      ? `\n  Continuity (${recentNodes.length} recent):${omittedNote}\n${knLines.join('\n')}`
      : '';
    return `  - ${p.id}: ${p.name} (${p.role})${knBlock}`;
  });

  // ── Location: recent continuity ────────────────────────────────────
  const locationBlock = (() => {
    if (!location) return '  - Unknown';
    const recentNodes = location.continuity.nodes.slice(-RECENT_CONTINUITY);
    const omitted = location.continuity.nodes.length - recentNodes.length;
    const knLines = recentNodes.map((kn) => `    (${kn.type}) ${kn.content}`);
    const omittedNote = omitted > 0 ? `\n    (${omitted} earlier items omitted)` : '';
    const knBlock = knLines.length > 0
      ? `\n  Continuity (${recentNodes.length} recent):${omittedNote}\n${knLines.join('\n')}`
      : '';
    const parent = location.parentId ? ` (inside ${narrative.locations[location.parentId]?.name ?? location.parentId})` : '';
    return `  - ${location.id}: ${location.name}${parent}${knBlock}`;
  })();

  // ── Relationships between participants ─────────────────────────────
  const relevantRelationships = narrative.relationships.filter(
    (r) => participantIdSet.has(r.from) && participantIdSet.has(r.to),
  );
  const relationshipStateLines = relevantRelationships.map((r) => {
    const fromName = narrative.characters[r.from]?.name ?? r.from;
    const toName = narrative.characters[r.to]?.name ?? r.to;
    return `  - ${fromName} → ${toName}: ${r.type} (valence: ${Math.round(r.valence * 100) / 100})`;
  });

  // ── Threads involved in this scene ─────────────────────────────────
  const threadIds = new Set(scene.threadMutations.map((tm) => tm.threadId));
  const threadBlocks = [...threadIds].map((tid) => {
    const thread = narrative.threads[tid];
    if (!thread) return `  - ${tid}: unknown`;
    const participants = thread.participants.map((a) => {
      if (a.type === 'character') return narrative.characters[a.id]?.name ?? a.id;
      if (a.type === 'location') return narrative.locations[a.id]?.name ?? a.id;
      return a.id;
    });
    return `  - ${tid}: "${thread.description}" [${thread.status}] participants: ${participants.join(', ')}`;
  });

  // ── Scene mutations ────────────────────────────────────────────────
  const threadMutationLines = scene.threadMutations.map((tm) => {
    const thread = narrative.threads[tm.threadId];
    return `  - "${thread?.description ?? tm.threadId}": ${tm.from} → ${tm.to}`;
  });

  const continuityMutationLines = scene.continuityMutations.map((km) => {
    const char = narrative.characters[km.characterId];
    return `  - ${char?.name ?? km.characterId} ${km.action === 'added' ? 'learns' : 'loses'}: [${km.nodeType ?? 'knowledge'}] ${km.content}`;
  });

  const relationshipMutationLines = scene.relationshipMutations.map((rm) => {
    const fromName = narrative.characters[rm.from]?.name ?? rm.from;
    const toName = narrative.characters[rm.to]?.name ?? rm.to;
    return `  - ${fromName} → ${toName}: ${rm.type} (${rm.valenceDelta >= 0 ? '+' : ''}${Math.round(rm.valenceDelta * 100) / 100})`;
  });

  const movementLines = scene.characterMovements
    ? Object.entries(scene.characterMovements).map(([charId, mv]) => {
        const char = narrative.characters[charId];
        const loc = narrative.locations[mv.locationId];
        return `  - ${char?.name ?? charId} moves to ${loc?.name ?? mv.locationId} (${mv.transition})`;
      })
    : [];

  const SEP = '────────────────────────────────────────';

  return [
    `Scene: ${scene.id}`,
    `Summary: ${scene.summary}`,
    `Arc: ${arc?.name ?? 'standalone'}`,
    `POV: ${pov?.name ?? 'Unknown'} (${pov?.role ?? 'unknown role'})`,
    ``,
    SEP,
    `CHARACTERS:`,
    ...characterBlocks,
    ``,
    SEP,
    `LOCATION:`,
    locationBlock,
    ``,
    ...(relationshipStateLines.length > 0 ? [
      SEP,
      `RELATIONSHIPS (current state):`,
      ...relationshipStateLines,
      ``,
    ] : []),
    ...(threadBlocks.length > 0 ? [
      SEP,
      `THREADS (involved):`,
      ...threadBlocks,
      ``,
    ] : []),
    SEP,
    `EVENTS:`,
    ...scene.events.map((e) => `  - ${e}`),
    ...(threadMutationLines.length > 0 ? [
      ``,
      SEP,
      `THREAD SHIFTS:`,
      ...threadMutationLines,
    ] : []),
    ...(continuityMutationLines.length > 0 ? [
      ``,
      SEP,
      `CONTINUITY CHANGES:`,
      ...continuityMutationLines,
    ] : []),
    ...(relationshipMutationLines.length > 0 ? [
      ``,
      SEP,
      `RELATIONSHIP SHIFTS:`,
      ...relationshipMutationLines,
    ] : []),
    ...(() => {
      const wkm = scene.worldKnowledgeMutations;
      if (!wkm || ((wkm.addedNodes?.length ?? 0) === 0 && (wkm.addedEdges?.length ?? 0) === 0)) return [];
      const lines: string[] = [``, SEP, `WORLD KNOWLEDGE REVEALS:`];
      for (const node of wkm.addedNodes ?? []) {
        lines.push(`  - New concept: ${node.concept} [${node.type}]`);
      }
      for (const edge of wkm.addedEdges ?? []) {
        const fromLabel = narrative.worldKnowledge.nodes[edge.from]?.concept ?? edge.from;
        const toLabel = narrative.worldKnowledge.nodes[edge.to]?.concept ?? edge.to;
        lines.push(`  - Connection: ${fromLabel} → ${edge.relation} → ${toLabel}`);
      }
      return lines;
    })(),
    ...(movementLines.length > 0 ? [
      ``,
      SEP,
      `MOVEMENTS:`,
      ...movementLines,
    ] : []),
  ].join('\n');
}

/** Estimate scene complexity to drive dynamic length guidance.
 *  Returns { prose: { min, max, tokens }, plan: { words } } */
export function sceneScale(scene: Scene): { proseMin: number; proseMax: number; proseTokens: number; planWords: string } {
  const mutations = scene.threadMutations.length + scene.continuityMutations.length + scene.relationshipMutations.length;
  const events = scene.events.length;
  const movements = scene.characterMovements ? Object.keys(scene.characterMovements).length : 0;
  const participants = scene.participantIds.length;
  const summaryLen = scene.summary.length;

  // Complexity score: more mutations, events, participants, and longer summaries = bigger scene
  const complexity = mutations * 2 + events * 1.5 + movements + participants * 0.5 + (summaryLen > 200 ? 2 : 0) + (summaryLen > 400 ? 3 : 0);

  let proseMin: number;
  let proseMax: number;
  if (complexity <= 4) { proseMin = 800; proseMax = 1200; }
  else if (complexity <= 8) { proseMin = 1000; proseMax = 1500; }
  else if (complexity <= 14) { proseMin = 1200; proseMax = 2500; }
  else if (complexity <= 20) { proseMin = 1500; proseMax = 3500; }
  else { proseMin = 2000; proseMax = 5000; }

  // Token budget: ~1.3 tokens per word + headroom
  const proseTokens = Math.ceil(proseMax * 1.5);
  // Plan scales proportionally — roughly 40-60% of prose length in words
  const planMin = Math.round(proseMin * 0.4);
  const planMax = Math.round(proseMax * 0.5);
  const planWords = `${planMin}-${planMax}`;

  return { proseMin, proseMax, proseTokens, planWords };
}

/** Deterministically derive logical rules from the scene graph — no LLM needed.
 *  Returns plain-text rules the prose must obey (spatial, POV, knowledge, relationships, threads). */
export function deriveLogicRules(narrative: NarrativeState, scene: Scene): string[] {
  const rules: string[] = [];

  const participantNames = scene.participantIds
    .map((pid) => narrative.characters[pid]?.name)
    .filter(Boolean);
  const participantIdSet = new Set(scene.participantIds);
  const location = narrative.locations[scene.locationId];
  const pov = narrative.characters[scene.povId];

  // Spatial: only participants can appear
  if (participantNames.length > 0 && location) {
    const absentNames = Object.values(narrative.characters)
      .filter((c) => !participantIdSet.has(c.id))
      .map((c) => c.name)
      .slice(0, 3);
    if (absentNames.length > 0) {
      rules.push(`Only these characters are present at ${location.name}: ${participantNames.join(', ')}. No other characters (e.g. ${absentNames.join(', ')}) may physically appear, speak, or interact.`);
    }
  }

  // POV constraint
  if (pov) {
    const otherParticipants = scene.participantIds
      .filter((pid) => pid !== scene.povId)
      .map((pid) => narrative.characters[pid]?.name)
      .filter(Boolean);
    if (otherParticipants.length > 0) {
      rules.push(`POV is locked to ${pov.name}. Do not reveal the internal thoughts, feelings, or private knowledge of ${otherParticipants.join(', ')} — only what ${pov.name} can observe, hear, or infer.`);
    }
  }

  // ── POV knowledge boundary ──────────────────────────────────────────
  if (pov) {
    const povKnowledgeIds = new Set(pov.continuity.nodes.map((kn) => kn.id));
    // Knowledge being added to POV this scene — they don't have it at the START
    const povLearnsThisScene = new Set(
      scene.continuityMutations
        .filter((km) => km.characterId === pov.id && km.action === 'added')
        .map((km) => km.nodeId),
    );
    // POV's knowledge at scene START = current graph - things learned this scene
    const povStartKnowledge = pov.continuity.nodes.filter(
      (kn) => !povLearnsThisScene.has(kn.id),
    );

    // Summarize what POV knows at scene start (cap to avoid bloat)
    if (povStartKnowledge.length > 0) {
      rules.push(`${pov.name}'s knowledge at scene start (narration is limited to this): ${povStartKnowledge.map((kn) => `"${kn.content}"`).join(', ')}. The narrator must NOT reference, explain, or frame events using information outside this set.`);
    }

    // Flag knowledge that other participants have but POV does NOT
    for (const pid of scene.participantIds) {
      if (pid === pov.id) continue;
      const other = narrative.characters[pid];
      if (!other) continue;
      const otherExclusive = other.continuity.nodes.filter(
        (kn) => !povKnowledgeIds.has(kn.id) && !povLearnsThisScene.has(kn.id),
      );
      if (otherExclusive.length > 0) {
        const examples = otherExclusive.slice(-3).map((kn) => `"${kn.content}"`).join(', ');
        rules.push(`${other.name} knows things ${pov.name} does NOT: ${examples}${otherExclusive.length > 3 ? ` (and ${otherExclusive.length - 3} more)` : ''}. The narrator must NOT reveal, hint at, or frame ${other.name}'s actions using this hidden knowledge. ${pov.name} can only observe ${other.name}'s external behaviour and draw their own (possibly wrong) conclusions.`);
      }
    }
  }

  // Knowledge mutations — temporal ordering within this scene
  for (const km of scene.continuityMutations) {
    if (km.action !== 'added') continue;
    const char = narrative.characters[km.characterId];
    if (!char) continue;
    if (km.characterId === scene.povId) {
      rules.push(`${char.name} (POV) does NOT know "${km.content}" at scene start — they learn it during the scene. Before the discovery moment, the narrator must not reference this information even obliquely. Show genuine surprise/realisation, not dramatic irony.`);
    } else {
      rules.push(`${char.name} does NOT know "${km.content}" at scene start — they learn it during the scene. Since POV is ${pov?.name ?? 'another character'}, show this discovery only through ${char.name}'s observable reaction (expression, body language, dialogue), not through their inner thoughts.`);
    }
  }

  // Relationship valence consistency — compute PRE-scene valence by subtracting this scene's deltas
  const mutationDeltaMap = new Map<string, number>();
  for (const rm of scene.relationshipMutations) {
    const key = `${rm.from}->${rm.to}`;
    mutationDeltaMap.set(key, (mutationDeltaMap.get(key) ?? 0) + rm.valenceDelta);
  }

  const participantRelationships = narrative.relationships.filter(
    (r) => participantIdSet.has(r.from) && participantIdSet.has(r.to),
  );
  for (const r of participantRelationships) {
    const fromName = narrative.characters[r.from]?.name;
    const toName = narrative.characters[r.to]?.name;
    if (!fromName || !toName) continue;

    // Pre-scene valence = current valence minus any deltas applied by this scene
    const key = `${r.from}->${r.to}`;
    const delta = mutationDeltaMap.get(key) ?? 0;
    const preSceneValence = Math.round((r.valence - delta) * 100) / 100;

    // Skip edges that have mutations — the relationship mutation rules below handle those
    if (delta !== 0) continue;

    if (preSceneValence <= -0.5) {
      rules.push(`${fromName} → ${toName} relationship is hostile (valence ${preSceneValence}). Their interaction must reflect animosity, distrust, or conflict — no friendly or warm exchanges.`);
    } else if (preSceneValence <= -0.1) {
      rules.push(`${fromName} → ${toName} relationship is tense (valence ${preSceneValence}). Their interaction should carry friction, wariness, or unease.`);
    }
  }

  // Thread temporal ordering
  for (const tm of scene.threadMutations) {
    const thread = narrative.threads[tm.threadId];
    if (!thread) continue;
    rules.push(`Thread "${thread.description}" is "${tm.from}" at scene start and must transition to "${tm.to}" during the scene. Do not begin with the thread already in its end state.`);
  }

  // Relationship mutations — include pre-scene valence for context
  for (const rm of scene.relationshipMutations) {
    const fromName = narrative.characters[rm.from]?.name;
    const toName = narrative.characters[rm.to]?.name;
    if (!fromName || !toName) continue;
    const edge = narrative.relationships.find((r) => r.from === rm.from && r.to === rm.to);
    const postValence = edge?.valence ?? 0;
    const preValence = Math.round((postValence - rm.valenceDelta) * 100) / 100;
    const delta = Math.round(rm.valenceDelta * 100) / 100;
    rules.push(`${fromName} → ${toName} starts at valence ${preValence} and shifts by ${delta >= 0 ? '+' : ''}${delta} (${rm.type}) to end at ${Math.round(postValence * 100) / 100}. The prose must dramatise this change — show the relationship starting at its initial state and the shift happening through behaviour, dialogue, or action.`);
  }

  // Events
  for (const event of scene.events) {
    rules.push(`The event "${event}" must occur in this scene.`);
  }

  // World knowledge logic — new concepts vs established concepts
  if (scene.worldKnowledgeMutations) {
    const newNodeIds = new Set((scene.worldKnowledgeMutations.addedNodes ?? []).map((n) => n.id));
    // New concepts: must be revealed during the scene
    for (const addedNode of scene.worldKnowledgeMutations.addedNodes ?? []) {
      const shortConcept = addedNode.concept.includes(' — ') ? addedNode.concept.split(' — ')[0] : addedNode.concept;
      rules.push(`WORLD KNOWLEDGE REVEAL: "${shortConcept}" (${addedNode.type}) has NOT been established yet at scene start — it must be revealed through a specific mechanism (demonstration, explanation, discovery, action). Do not reference it as pre-existing before its revelation delivery.`);
    }
    // New edges: dramatise the connection
    for (const edge of scene.worldKnowledgeMutations.addedEdges ?? []) {
      const fromNode = narrative.worldKnowledge?.nodes[edge.from] ?? scene.worldKnowledgeMutations.addedNodes?.find((n) => n.id === edge.from);
      const toNode = narrative.worldKnowledge?.nodes[edge.to] ?? scene.worldKnowledgeMutations.addedNodes?.find((n) => n.id === edge.to);
      if (fromNode && toNode) {
        const fromShort = fromNode.concept.includes(' — ') ? fromNode.concept.split(' — ')[0] : fromNode.concept;
        const toShort = toNode.concept.includes(' — ') ? toNode.concept.split(' — ')[0] : toNode.concept;
        rules.push(`WORLD KNOWLEDGE CONNECTION: The relationship "${fromShort}" ${edge.relation} "${toShort}" must be demonstrated through the narrative — show it through action, dialogue, or consequence, not exposition.`);
      }
    }
    // Existing concepts referenced by edges: these ARE established and can be used freely
    const referencedExistingIds = new Set<string>();
    for (const edge of scene.worldKnowledgeMutations.addedEdges ?? []) {
      if (!newNodeIds.has(edge.from) && narrative.worldKnowledge?.nodes[edge.from]) referencedExistingIds.add(edge.from);
      if (!newNodeIds.has(edge.to) && narrative.worldKnowledge?.nodes[edge.to]) referencedExistingIds.add(edge.to);
    }
    if (referencedExistingIds.size > 0) {
      const established = [...referencedExistingIds].map((id) => {
        const node = narrative.worldKnowledge.nodes[id];
        return node?.concept.includes(' — ') ? node.concept.split(' — ')[0] : node?.concept ?? id;
      });
      rules.push(`ESTABLISHED WORLD KNOWLEDGE (can be referenced freely): ${established.join(', ')}.`);
    }
  }

  // Character movement
  if (scene.characterMovements) {
    for (const [charId, mv] of Object.entries(scene.characterMovements)) {
      const char = narrative.characters[charId];
      const newLoc = narrative.locations[mv.locationId];
      if (!char || !newLoc) continue;
      rules.push(`${char.name} moves to ${newLoc.name} during this scene (${mv.transition}). They start at ${location?.name ?? 'the current location'} — show the transition, not them already at ${newLoc.name}.`);
    }
  }

  return rules;
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

  // Replay continuity mutations up to this point to know which nodes are live
  const liveNodeIds = new Set<string>();
  for (const k of keysUpToCurrent) {
    const entry = resolveEntry(n, k);
    if (entry?.kind !== 'scene') continue;
    for (const km of entry.continuityMutations) {
      if (km.action === 'added') liveNodeIds.add(km.nodeId);
      else liveNodeIds.delete(km.nodeId);
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
        const nodes = c.continuity.nodes.filter((kn) => liveNodeIds.has(kn.id));
        const continuityBlock = nodes.length > 0
          ? `\n    Continuity: ${nodes.map((kn) => `(${kn.type}) ${kn.content}`).join(' | ')}`
          : '';
        return `  - ${mc.id}: ${c.name} (${c.role})${continuityBlock}`;
      })
      .filter(Boolean)
      .join('\n');

    const locLines = manifestLocs
      .map((ml) => {
        const l = n.locations[ml.id];
        if (!l) return null;
        const parent = l.parentId ? ` ⊂ ${n.locations[l.parentId]?.name ?? l.parentId}` : '';
        const loreBlock = l.continuity.nodes.length > 0
          ? `\n    Lore: ${l.continuity.nodes.map((kn) => kn.content).join(' | ')}`
          : '';
        return `  - ${ml.id}: ${l.name}${parent}${loreBlock}`;
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
        return `  - ${mt.id}: "${t.description}" [${status}] participants: ${participantNames}`;
      })
      .filter(Boolean)
      .join('\n');

    const parts: string[] = [
      `[${wxKey}] ${wb.summary}`,
      charLines ? `  CHARACTERS:\n${charLines}` : '  CHARACTERS: (none)',
      locLines ? `  LOCATIONS:\n${locLines}` : '  LOCATIONS: (none)',
      threadLines ? `  THREADS:\n${threadLines}` : '  THREADS: (none)',
    ];
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
    wkBlock = `\n────────────────────────────────────────
WORLD KNOWLEDGE GRAPH (${rankedNodes.length} concepts, ${wk.edges.length} relationships):
${nodeLines.join('\n')}\n`;
  }

  const rulesBlock = n.rules?.length
    ? `WORLD RULES:\n${n.rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\n`
    : '';

  const sceneCount = keysUpToCurrent.filter((k) => n.scenes[k]).length;

  return `WORLD STATE: "${n.title}" — ${sceneCount} scenes, ${wxKeys.length} world commits
SUMMARY: ${n.worldSummary ?? ''}

${rulesBlock}────────────────────────────────────────
WORLD COMMITS (chronological — each section shows what was introduced):

${commitSections.join('\n\n────────────────────────────────────────\n')}
${wkBlock}`;
}
