'use client';

import React, { createContext, useContext, useReducer, useEffect, useRef, useMemo, type ReactNode } from 'react';
import type { AppState, InspectorContext, NarrativeState, NarrativeEntry, WizardStep, WizardData, Scene, Arc, Branch, Character, Location, Thread, RelationshipEdge, GraphViewMode, AutoConfig, AutoRunLog, WorldBuild, WorldKnowledgeGraph, WorldKnowledgeNode, WorldKnowledgeEdge, WorldKnowledgeMutation, ApiLogEntry, SystemLogEntry, StorySettings, AnalysisJob, ChatThread, ChatMessage, Note, PlanningQueue, PlanningPhase, Artifact, StructureReview, ProseEvaluation, PlanEvaluation, WorldSystem, ProseProfile, BeatProfilePreset, MechanismProfilePreset, BeatPlan, BeatProseMap, ProseScore, SearchQuery, OwnershipMutation, TieMutation, ContinuityMutation, RelationshipMutation } from '@/types/narrative';
import { applyContinuityMutation } from '@/lib/continuity-graph';
import { applyThreadMutation } from '@/lib/thread-log';
import { sanitizeWorldKnowledgeMutation, applyWorldKnowledgeMutation } from '@/lib/world-knowledge-graph';
import { resolveEntrySequence, nextId, computeForceSnapshots, computeSwingMagnitudes, computeDeliveryCurve, classifyNarrativeShape, classifyArchetype, classifyScale, classifyWorldDensity, gradeForces, computeRawForceTotals, FORCE_REFERENCE_MEANS } from '@/lib/narrative-utils';
import { initMatrixPresets } from '@/lib/pacing-profile';
import { initBeatProfilePresets } from '@/lib/beat-profiles';
import { initMechanismProfilePresets } from '@/lib/mechanism-profiles';
import { resolveEntry, isScene } from '@/types/narrative';
import { loadNarratives, saveNarrative as persistNarrative, deleteNarrative as deletePersisted, loadNarrative, saveActiveNarrativeId, loadActiveNarrativeId, saveActiveBranchId, loadActiveBranchId, migrateFromLocalStorage, loadAnalysisJobs, saveAnalysisJobs, deleteApiLogs, deleteAnalysisApiLogs, saveSearchState, loadSearchState } from '@/lib/persistence';
import { API_LOG_STALE_THRESHOLD_MS } from '@/lib/constants';
import { logError, logWarning } from '@/lib/system-logger';
import { assetManager } from '@/lib/asset-manager';

// Bundled narratives loaded at runtime from /public manifests
const bundledNarratives = new Map<string, NarrativeState>();

function computeDerivedEntities(
  worldBuilds: Record<string, WorldBuild>,
  scenes: Record<string, Scene>,
  resolvedKeys: string[],
): { characters: Record<string, Character>; locations: Record<string, Location>; threads: Record<string, Thread>; artifacts: Record<string, Artifact>; relationships: RelationshipEdge[]; worldKnowledge: WorldKnowledgeGraph } {
  const characters: Record<string, Character> = {};
  const locations: Record<string, Location> = {};
  const threads: Record<string, Thread> = {};
  const artifacts: Record<string, Artifact> = {};
  let relationships: RelationshipEdge[] = [];
  const wkNodes: Record<string, WorldKnowledgeNode> = {};
  const wkEdges: WorldKnowledgeEdge[] = [];

  // Graph derivation uses the shared sanitize→apply pipeline so that
  // self-loops, orphans, bad fields, and cross-mutation duplicates are all
  // filtered consistently with the generation and analysis pipelines.
  const seenWkEdgeKeys = new Set<string>();
  const applyWkMutation = (wkm: WorldKnowledgeMutation) => {
    if (!wkm) return;
    // Clone so we don't mutate the entry's stored mutation in place during derivation.
    const clone: WorldKnowledgeMutation = {
      addedNodes: [...(wkm.addedNodes ?? [])],
      addedEdges: [...(wkm.addedEdges ?? [])],
    };
    // Valid ids at this moment: everything already in the accumulating graph
    // plus anything this mutation is about to contribute.
    const validIds = new Set<string>(Object.keys(wkNodes));
    for (const n of clone.addedNodes) if (n?.id) validIds.add(n.id);
    sanitizeWorldKnowledgeMutation(clone, validIds, seenWkEdgeKeys);
    applyWorldKnowledgeMutation({ nodes: wkNodes, edges: wkEdges }, clone);
  };

  for (const key of resolvedKeys) {
    const wb = worldBuilds[key];
    if (wb) {
      for (const c of wb.expansionManifest.characters) {
        characters[c.id] = { ...c, continuity: { nodes: c.continuity?.nodes ?? {}, edges: c.continuity?.edges ?? [] } };
      }
      for (const l of wb.expansionManifest.locations) {
        locations[l.id] = { ...l, tiedCharacterIds: l.tiedCharacterIds ?? [], continuity: { nodes: l.continuity?.nodes ?? {}, edges: l.continuity?.edges ?? [] } };
      }
      for (const t of wb.expansionManifest.threads) {
        threads[t.id] = { ...t };
      }
      // Collect relationships (deduplicated by from+to)
      for (const r of wb.expansionManifest.relationships ?? []) {
        const exists = relationships.some((x) => x.from === r.from && x.to === r.to);
        if (!exists) relationships.push({ ...r });
      }
      // Collect artifacts — merge continuity if artifact already exists
      for (const a of wb.expansionManifest.artifacts ?? []) {
        const existing = artifacts[a.id];
        const aCont = { nodes: a.continuity?.nodes ?? {}, edges: a.continuity?.edges ?? [] };
        if (existing) {
          artifacts[a.id] = {
            ...existing,
            ...a,
            continuity: { nodes: { ...existing.continuity.nodes, ...aCont.nodes }, edges: [...existing.continuity.edges, ...aCont.edges] },
          };
        } else {
          artifacts[a.id] = { ...a, threadIds: a.threadIds ?? [], continuity: aCont };
        }
      }
      // Collect world knowledge
      applyWkMutation(wb.expansionManifest.worldKnowledge ?? { addedNodes: [], addedEdges: [] });
      // Apply expansion mutations on existing entities
      for (const km of wb.expansionManifest.continuityMutations ?? []) {
        const char = characters[km.entityId];
        const loc = locations[km.entityId];
        const art = artifacts[km.entityId];
        if (char) characters[km.entityId] = { ...char, continuity: applyContinuityMutation(char.continuity, km) };
        else if (loc) locations[km.entityId] = { ...loc, continuity: applyContinuityMutation(loc.continuity, km) };
        else if (art) artifacts[km.entityId] = { ...art, continuity: applyContinuityMutation(art.continuity, km) };
      }
      for (const rm of wb.expansionManifest.relationshipMutations ?? []) {
        const idx = relationships.findIndex((r) => r.from === rm.from && r.to === rm.to);
        if (idx >= 0) {
          const existing = relationships[idx];
          relationships = [...relationships.slice(0, idx), { ...existing, type: rm.type, valence: Math.max(-1, Math.min(1, existing.valence + rm.valenceDelta)) }, ...relationships.slice(idx + 1)];
        } else {
          relationships.push({ from: rm.from, to: rm.to, type: rm.type, valence: Math.max(-1, Math.min(1, rm.valenceDelta)) });
        }
      }
      for (const om of wb.expansionManifest.ownershipMutations ?? []) {
        const art = artifacts[om.artifactId];
        if (art) artifacts[om.artifactId] = { ...art, parentId: om.toId };
      }
      for (const mm of wb.expansionManifest.tieMutations ?? []) {
        const loc = locations[mm.locationId];
        if (loc) {
          if (mm.action === 'add' && !loc.tiedCharacterIds.includes(mm.characterId)) {
            locations[mm.locationId] = { ...loc, tiedCharacterIds: [...loc.tiedCharacterIds, mm.characterId] };
          } else if (mm.action === 'remove') {
            locations[mm.locationId] = { ...loc, tiedCharacterIds: loc.tiedCharacterIds.filter(id => id !== mm.characterId) };
          }
        }
      }
    } else {
      const scene = scenes[key];
      if (!scene) continue;
      for (const km of scene.continuityMutations ?? []) {
        // Continuity mutations can target characters, locations, or artifacts
        const char = characters[km.entityId];
        const loc = locations[km.entityId];
        const art = artifacts[km.entityId];
        if (char) {
          characters[km.entityId] = { ...char, continuity: applyContinuityMutation(char.continuity, km) };
        } else if (loc) {
          locations[km.entityId] = { ...loc, continuity: applyContinuityMutation(loc.continuity, km) };
        } else if (art) {
          artifacts[km.entityId] = { ...art, continuity: applyContinuityMutation(art.continuity, km) };
        }
      }
      for (const tm of scene.threadMutations ?? []) {
        const thread = threads[tm.threadId];
        if (!thread) continue;
        threads[tm.threadId] = {
          ...thread,
          status: tm.to,
          threadLog: applyThreadMutation(thread.threadLog, tm),
        };
      }
      // Apply relationship mutations from scene
      for (const rm of scene.relationshipMutations ?? []) {
        const idx = relationships.findIndex((r) => r.from === rm.from && r.to === rm.to);
        if (idx >= 0) {
          const existing = relationships[idx];
          relationships = [
            ...relationships.slice(0, idx),
            { ...existing, type: rm.type, valence: Math.max(-1, Math.min(1, existing.valence + rm.valenceDelta)) },
            ...relationships.slice(idx + 1),
          ];
        } else {
          relationships.push({ from: rm.from, to: rm.to, type: rm.type, valence: Math.max(-1, Math.min(1, rm.valenceDelta)) });
        }
      }
      // Apply world knowledge mutations from scene
      if (scene.worldKnowledgeMutations) {
        applyWkMutation(scene.worldKnowledgeMutations);
      }
      // Apply ownership mutations from scene
      for (const om of scene.ownershipMutations ?? []) {
        const art = artifacts[om.artifactId];
        if (art) {
          artifacts[om.artifactId] = { ...art, parentId: om.toId };
        }
      }
      // Apply tie mutations from scene
      for (const mm of scene.tieMutations ?? []) {
        const loc = locations[mm.locationId];
        if (loc) {
          if (mm.action === 'add' && !loc.tiedCharacterIds.includes(mm.characterId)) {
            locations[mm.locationId] = { ...loc, tiedCharacterIds: [...loc.tiedCharacterIds, mm.characterId] };
          } else if (mm.action === 'remove') {
            locations[mm.locationId] = { ...loc, tiedCharacterIds: loc.tiedCharacterIds.filter(id => id !== mm.characterId) };
          }
        }
      }
    }
  }

  // Compute threadIds on all entities from thread participants
  for (const thread of Object.values(threads)) {
    for (const anchor of thread.participants) {
      if (anchor.type === 'character' && characters[anchor.id]) {
        const char = characters[anchor.id];
        if (!char.threadIds.includes(thread.id)) {
          characters[anchor.id] = { ...char, threadIds: [...char.threadIds, thread.id] };
        }
      } else if (anchor.type === 'location' && locations[anchor.id]) {
        const loc = locations[anchor.id];
        if (!loc.threadIds.includes(thread.id)) {
          locations[anchor.id] = { ...loc, threadIds: [...loc.threadIds, thread.id] };
        }
      } else if (anchor.type === 'artifact' && artifacts[anchor.id]) {
        const art = artifacts[anchor.id];
        if (!art.threadIds.includes(thread.id)) {
          artifacts[anchor.id] = { ...art, threadIds: [...art.threadIds, thread.id] };
        }
      }
    }
  }

  // Strip orphan edges — edges referencing node IDs that were never defined as actual nodes
  const validWkEdges = wkEdges.filter((e) => wkNodes[e.from] && wkNodes[e.to]);

  return { characters, locations, threads, artifacts, relationships, worldKnowledge: { nodes: wkNodes, edges: validWkEdges } };
}

export function withDerivedEntities(n: NarrativeState, resolvedKeys: string[]): NarrativeState {
  const derived = computeDerivedEntities(n.worldBuilds, n.scenes, resolvedKeys);
  return { ...n, characters: derived.characters, locations: derived.locations, threads: derived.threads, artifacts: derived.artifacts, relationships: derived.relationships, worldKnowledge: derived.worldKnowledge };
}


export function narrativeToEntry(n: NarrativeState): NarrativeEntry {
  const threadValues = Object.values(n.threads);

  // Compute shape, archetype, and score from scenes
  const branchId = getRootBranchId(n);
  const keys = branchId ? resolveEntrySequence(n.branches, branchId) : [...Object.keys(n.scenes), ...Object.keys(n.worldBuilds)];
  const allScenes = keys.map((k) => resolveEntry(n, k)).filter((e): e is Scene => !!e && isScene(e));

  let shapeKey: string | undefined;
  let shapeName: string | undefined;
  let shapeCurve: [number, number][] | undefined;
  let archetypeKey: string | undefined;
  let archetypeName: string | undefined;
  let overallScore: number | undefined;
  let scaleKey: string | undefined;
  let scaleName: string | undefined;
  let densityKey: string | undefined;
  let densityName: string | undefined;

  // Scale and density can be computed with any scene count
  const scale = classifyScale(allScenes.length);
  scaleKey = scale.key;
  scaleName = scale.name;
  // Entity continuity graph density — total nodes and edges across all entities
  const allEntities = [...Object.values(n.characters), ...Object.values(n.locations), ...Object.values(n.artifacts ?? {})];
  const entityContinuityNodes = allEntities.reduce((sum, e) => sum + Object.keys(e.continuity?.nodes ?? {}).length, 0);
  const entityContinuityEdges = allEntities.reduce((sum, e) => sum + (e.continuity?.edges?.length ?? 0), 0);
  const density = classifyWorldDensity(
    allScenes.length,
    Object.keys(n.characters).length,
    Object.keys(n.locations).length,
    Object.keys(n.threads).length,
    Object.keys(n.worldKnowledge?.nodes ?? {}).length,
    entityContinuityNodes,
    entityContinuityEdges,
  );
  densityKey = density.key;
  densityName = density.name;

  if (allScenes.length >= 3) {
    const raw = computeRawForceTotals(allScenes);
    const rawForces = raw.drive.map((_, i) => ({
      drive: raw.drive[i],
      world: raw.world[i],
      system: raw.system[i],
    }));
    const swings = computeSwingMagnitudes(rawForces, FORCE_REFERENCE_MEANS);
    const forceMap = computeForceSnapshots(allScenes);
    const ordered = allScenes.map((s) => forceMap[s.id] ?? { drive: 0, world: 0, system: 0 });
    const deliveryPoints = computeDeliveryCurve(ordered);
    const grades = gradeForces(raw.drive, raw.world, raw.system, swings);

    const shape = classifyNarrativeShape(deliveryPoints.map((d) => d.delivery));
    const archetype = classifyArchetype(grades);
    shapeKey = shape.key;
    shapeName = shape.name;
    shapeCurve = shape.curve;
    archetypeKey = archetype.key;
    archetypeName = archetype.name;
    overallScore = grades.overall;
  }

  return {
    id: n.id,
    title: n.title,
    description: n.description,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    sceneCount: allScenes.length,
    coverThread: threadValues[0]?.description ?? '',
    coverImageUrl: n.coverImageUrl,
    shapeKey, shapeName, shapeCurve,
    archetypeKey, archetypeName,
    overallScore,
    scaleKey, scaleName,
    densityKey, densityName,
  };
}

function getRootBranchId(n: NarrativeState): string | null {
  const root = Object.values(n.branches).find((b) => b.parentBranchId === null);
  return root?.id ?? null;
}

function getResolvedKeys(n: NarrativeState, branchId: string | null): string[] {
  if (!branchId) return [...Object.keys(n.scenes), ...Object.keys(n.worldBuilds)];
  return resolveEntrySequence(n.branches, branchId);
}

const SEED_IDS = new Set<string>();
const PLAYGROUND_IDS = new Set<string>();
const ANALYSIS_IDS = new Set<string>();

// Pure state updater — no persistence side effects
function updateNarrative(
  state: AppState,
  updater: (n: NarrativeState) => NarrativeState,
): AppState {
  if (!state.activeNarrative) return state;
  const updated = updater(state.activeNarrative);
  updated.updatedAt = Date.now();
  return {
    ...state,
    activeNarrative: updated,
    narratives: state.narratives.map((e) =>
      e.id === updated.id ? narrativeToEntry(withDerivedEntities(updated, state.resolvedEntryKeys)) : e,
    ),
  };
}


export const SEED_NARRATIVE_IDS = SEED_IDS;
export const PLAYGROUND_NARRATIVE_IDS = PLAYGROUND_IDS;
export const ANALYSIS_NARRATIVE_IDS = ANALYSIS_IDS;


const initialState: AppState = {
  narratives: [],
  activeNarrativeId: null,
  activeNarrative: null,
  isPlaying: false,
  currentSceneIndex: 0,
  activeBranchId: null,
  resolvedEntryKeys: [],
  inspectorContext: null,
  inspectorHistory: [],
  wizardOpen: false,
  wizardStep: 'form',
  wizardData: { title: '', premise: '', characters: [], locations: [], threads: [], rules: [], worldSystems: [] },
  selectedKnowledgeEntity: null,
  selectedThreadLog: null,
  graphViewMode: 'search',
  currentSearchQuery: null,
  currentResultIndex: 0,
  searchFocusMode: false,
  autoConfig: {
    endConditions: [{ type: 'scene_count', target: 50 }],
    minArcLength: 2,
    maxArcLength: 5,
    maxActiveThreads: 6,
    threadStagnationThreshold: 5,
    direction: '',
    toneGuidance: '',
    narrativeConstraints: '',
    characterRotationEnabled: true,
    minScenesBetweenCharacterFocus: 3,
  },
  autoRunState: null,
  apiLogs: [],
  systemLogs: [],
  analysisJobs: [],
  activeChatThreadId: null,
  activeNoteId: null,
  beatProfilePresets: [],
  mechanismProfilePresets: [],
};

// ── Actions ──────────────────────────────────────────────────────────────────
export type Action =
  | { type: 'HYDRATE_NARRATIVES'; entries: NarrativeEntry[] }
  | { type: 'ADD_NARRATIVE_ENTRY'; entry: NarrativeEntry }
  | { type: 'SET_ACTIVE_NARRATIVE'; id: string }
  | { type: 'LOADED_NARRATIVE'; narrative: NarrativeState; savedBranchId?: string | null }
  | { type: 'TOGGLE_PLAY' }
  | { type: 'NEXT_SCENE' }
  | { type: 'PREV_SCENE' }
  | { type: 'SET_SCENE_INDEX'; index: number }
  | { type: 'SET_INSPECTOR'; context: InspectorContext | null }
  | { type: 'INSPECTOR_BACK' }
  | { type: 'OPEN_WIZARD'; prefill?: string; prefillData?: Partial<WizardData> }
  | { type: 'CLOSE_WIZARD' }
  | { type: 'SET_WIZARD_STEP'; step: WizardStep }
  | { type: 'UPDATE_WIZARD_DATA'; data: Partial<WizardData> }
  | { type: 'ADD_NARRATIVE'; narrative: NarrativeState }
  | { type: 'DELETE_NARRATIVE'; id: string }
  | { type: 'SELECT_KNOWLEDGE_ENTITY'; entityId: string | null }
  | { type: 'SELECT_THREAD_LOG'; threadId: string | null }
  | { type: 'SET_GRAPH_VIEW_MODE'; mode: GraphViewMode }
  // Search
  | { type: 'SET_SEARCH_QUERY'; query: SearchQuery }
  | { type: 'SET_SEARCH_RESULT_INDEX'; index: number }
  | { type: 'CLEAR_SEARCH' }
  | { type: 'TOGGLE_SEARCH_FOCUS' }
  | { type: 'SWITCH_BRANCH'; branchId: string }
  // Scene mutations
  | { type: 'UPDATE_SCENE'; sceneId: string; updates: Partial<Pick<Scene, 'summary' | 'events' | 'locationId' | 'participantIds' | 'povId' | 'threadMutations' | 'continuityMutations' | 'relationshipMutations' | 'worldKnowledgeMutations' | 'characterMovements' | 'arcId' | 'proseEmbedding' | 'summaryEmbedding' | 'planEmbeddingCentroid'>> & { prose?: string; plan?: BeatPlan; beatProseMap?: BeatProseMap; proseScore?: ProseScore }; versionType?: 'generate' | 'rewrite' | 'edit'; sourcePlanVersion?: string }
  | { type: 'DELETE_SCENE'; sceneId: string; branchId: string }
  // Branch management
  | { type: 'CREATE_BRANCH'; branch: Branch }
  | { type: 'DELETE_BRANCH'; branchId: string }
  | { type: 'RENAME_BRANCH'; branchId: string; name: string }
  | { type: 'SET_VERSION_POINTER'; branchId: string; sceneId: string; pointerType: 'prose' | 'plan'; version: string | undefined }
  | { type: 'REMOVE_BRANCH_ENTRY'; entryId: string; branchId: string }
  | { type: 'SET_STRUCTURE_REVIEW'; branchId: string; evaluation: StructureReview }
  | { type: 'SET_PROSE_EVALUATION'; branchId: string; evaluation: ProseEvaluation }
  | { type: 'SET_PLAN_EVALUATION'; branchId: string; evaluation: PlanEvaluation }
  // Bulk AI-generated content
  | { type: 'BULK_ADD_SCENES'; scenes: Scene[]; arc: Arc; branchId: string }
  | { type: 'RECONSTRUCT_BRANCH'; branchId: string; scenes: Scene[]; arcs: Record<string, Arc> }
  | { type: 'EXPAND_WORLD'; worldBuildId: string; characters: Character[]; locations: Location[]; threads: Thread[]; relationships: RelationshipEdge[]; branchId: string; worldKnowledgeMutations?: WorldKnowledgeMutation; artifacts?: Artifact[]; ownershipMutations?: OwnershipMutation[]; tieMutations?: TieMutation[]; continuityMutations?: ContinuityMutation[]; relationshipMutations?: RelationshipMutation[] }
  // Auto mode
  | { type: 'SET_AUTO_CONFIG'; config: AutoConfig }
  | { type: 'START_AUTO_RUN' }
  | { type: 'PAUSE_AUTO_RUN' }
  | { type: 'RESUME_AUTO_RUN' }
  | { type: 'STOP_AUTO_RUN' }
  | { type: 'SET_AUTO_STATUS'; message: string }
  | { type: 'LOG_AUTO_CYCLE'; entry: AutoRunLog }
  // API Logs
  | { type: 'LOG_API_CALL'; entry: ApiLogEntry }
  | { type: 'UPDATE_API_LOG'; id: string; updates: Partial<ApiLogEntry> }
  | { type: 'CLEAR_API_LOGS' }
  // System Logs
  | { type: 'LOG_SYSTEM'; entry: SystemLogEntry }
  | { type: 'CLEAR_SYSTEM_LOGS' }
  | { type: 'SET_COVER_IMAGE'; narrativeId: string; imageUrl: string }
  | { type: 'UPDATE_NARRATIVE_META'; narrativeId: string; title?: string; description?: string }
  | { type: 'SET_SCENE_IMAGE'; sceneId: string; imageUrl: string }
  | { type: 'SET_SCENE_AUDIO'; sceneId: string; audioUrl: string }
  | { type: 'CLEAR_SCENE_AUDIO'; sceneId: string }
  | { type: 'SET_CHARACTER_IMAGE'; characterId: string; imageUrl: string }
  | { type: 'SET_LOCATION_IMAGE'; locationId: string; imageUrl: string }
  | { type: 'SET_ARTIFACT_IMAGE'; artifactId: string; imageUrl: string }
  | { type: 'SET_IMAGE_STYLE'; style: string }
  | { type: 'SET_RULES'; rules: string[] }
  | { type: 'SET_WORLD_SYSTEMS'; systems: WorldSystem[] }
  | { type: 'SET_STORY_SETTINGS'; settings: StorySettings }
  | { type: 'SET_PROSE_PROFILE'; profile: ProseProfile | undefined }
  | { type: 'SET_BEAT_PROFILE_PRESETS'; presets: BeatProfilePreset[] }
  | { type: 'SET_MECHANISM_PROFILE_PRESETS'; presets: MechanismProfilePreset[] }
  // Analysis
  | { type: 'ADD_ANALYSIS_JOB'; job: AnalysisJob }
  | { type: 'UPDATE_ANALYSIS_JOB'; id: string; updates: Partial<AnalysisJob> }
  | { type: 'DELETE_ANALYSIS_JOB'; id: string }
  | { type: 'HYDRATE_ANALYSIS_JOBS'; jobs: AnalysisJob[] }
  // Chat threads
  | { type: 'CREATE_CHAT_THREAD'; thread: ChatThread }
  | { type: 'DELETE_CHAT_THREAD'; threadId: string }
  | { type: 'RENAME_CHAT_THREAD'; threadId: string; name: string }
  | { type: 'SET_ACTIVE_CHAT_THREAD'; threadId: string | null }
  | { type: 'UPSERT_CHAT_THREAD'; threadId: string; messages: ChatMessage[]; name?: string }
  // Notes
  | { type: 'CREATE_NOTE'; note: Note }
  | { type: 'DELETE_NOTE'; noteId: string }
  | { type: 'UPDATE_NOTE'; noteId: string; title?: string; content?: string }
  | { type: 'SET_ACTIVE_NOTE'; noteId: string | null }
  // Planning queue
  | { type: 'SET_PLANNING_QUEUE'; branchId: string; queue: PlanningQueue | undefined }
  | { type: 'UPDATE_PLANNING_PHASE'; branchId: string; phaseIndex: number; updates: Partial<PlanningPhase> }
  | { type: 'ADVANCE_PLANNING_PHASE'; branchId: string };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'HYDRATE_NARRATIVES': {
      return { ...state, narratives: action.entries };
    }
    case 'ADD_NARRATIVE_ENTRY': {
      // Add entry if not already present (by ID)
      if (state.narratives.some(n => n.id === action.entry.id)) {
        return state;
      }
      return { ...state, narratives: [...state.narratives, action.entry] };
    }
    case 'SET_ACTIVE_NARRATIVE': {
      // Just set the ID — the async loading effect will populate the narrative
      if (state.activeNarrativeId === action.id && state.activeNarrative) return state;
      return {
        ...state,
        activeNarrativeId: action.id,
        activeNarrative: null, // cleared until async load completes
        activeBranchId: null,
        resolvedEntryKeys: [],
        currentSceneIndex: 0,
        inspectorContext: null,
        selectedKnowledgeEntity: null,
        selectedThreadLog: null,
        activeChatThreadId: null,
        activeNoteId: null,
        currentSearchQuery: null, // Clear search when switching narratives
        currentResultIndex: 0,
        searchFocusMode: false,
      };
    }
    case 'LOADED_NARRATIVE': {
      // Async load completed — populate state
      if (state.activeNarrativeId !== action.narrative.id) return state; // stale
      const savedBranch = action.savedBranchId && action.narrative.branches[action.savedBranchId]
        ? action.savedBranchId
        : null;
      const branchId = savedBranch ?? getRootBranchId(action.narrative);
      const resolved = getResolvedKeys(action.narrative, branchId);
      const derivedNarrative = withDerivedEntities(action.narrative, resolved);
      return {
        ...state,
        activeNarrative: derivedNarrative,
        activeBranchId: branchId,
        resolvedEntryKeys: resolved,
        currentSceneIndex: resolved.length - 1,
      };
    }
    case 'TOGGLE_PLAY':
      return { ...state, isPlaying: !state.isPlaying };
    case 'NEXT_SCENE': {
      const max = state.resolvedEntryKeys.length - 1;
      const nextIdx = Math.min(state.currentSceneIndex + 1, Math.max(0, max));
      return { ...state, currentSceneIndex: nextIdx };
    }
    case 'PREV_SCENE': {
      const prevIdx = Math.max(state.currentSceneIndex - 1, 0);
      return { ...state, currentSceneIndex: prevIdx };
    }
    case 'SET_SCENE_INDEX':
      return { ...state, currentSceneIndex: action.index };
    case 'SET_INSPECTOR': {
      // Push current context to history stack before navigating (max 20 entries)
      const history = state.inspectorContext
        ? [...state.inspectorHistory.slice(-19), state.inspectorContext]
        : state.inspectorHistory;
      return { ...state, inspectorContext: action.context, inspectorHistory: action.context ? history : [] };
    }
    case 'INSPECTOR_BACK': {
      const prev = state.inspectorHistory[state.inspectorHistory.length - 1] ?? null;
      return { ...state, inspectorContext: prev, inspectorHistory: state.inspectorHistory.slice(0, -1) };
    }
    case 'OPEN_WIZARD':
      return { ...state, wizardOpen: true, wizardStep: action.prefillData ? 'details' : 'form', wizardData: { title: '', premise: action.prefill ?? '', characters: [], locations: [], threads: [], rules: [], worldSystems: [], ...action.prefillData } };
    case 'CLOSE_WIZARD':
      return { ...state, wizardOpen: false };
    case 'SET_WIZARD_STEP':
      return { ...state, wizardStep: action.step };
    case 'UPDATE_WIZARD_DATA':
      return { ...state, wizardData: { ...state.wizardData, ...action.data } };
    case 'ADD_NARRATIVE': {
      // Inject an initial world-building commit as the first timeline entry
      const n = { ...action.narrative, worldBuilds: { ...action.narrative.worldBuilds }, branches: { ...action.narrative.branches } };
      const rootBranch = Object.values(n.branches).find((b) => b.parentBranchId === null);
      const allChars = Object.values(n.characters);
      const allLocs = Object.values(n.locations);
      const allThreads = Object.values(n.threads);

      // Only inject a world-build commit if the narrative doesn't already have one
      const hasExistingWorldBuild = Object.keys(n.worldBuilds).length > 0;
      const worldBuildId = nextId('WB', Object.keys(n.worldBuilds), 3);
      if (rootBranch && !hasExistingWorldBuild && (allChars.length > 0 || allLocs.length > 0 || allThreads.length > 0)) {
        const parts: string[] = [];
        if (allChars.length > 0) parts.push(`${allChars.length} character${allChars.length > 1 ? 's' : ''} (${allChars.map((c) => c.name).join(', ')})`);
        if (allLocs.length > 0) parts.push(`${allLocs.length} location${allLocs.length > 1 ? 's' : ''} (${allLocs.map((l) => l.name).join(', ')})`);
        if (allThreads.length > 0) parts.push(`${allThreads.length} thread${allThreads.length > 1 ? 's' : ''}`);
        if (n.relationships.length > 0) parts.push(`${n.relationships.length} relationship${n.relationships.length > 1 ? 's' : ''}`);

        const allArtifacts = Object.values(n.artifacts ?? {});
        const wkNodeCount = Object.keys(n.worldKnowledge?.nodes ?? {}).length;
        if (allArtifacts.length > 0) parts.push(`${allArtifacts.length} artifact${allArtifacts.length > 1 ? 's' : ''}`);
        if (wkNodeCount > 0) parts.push(`${wkNodeCount} knowledge node${wkNodeCount > 1 ? 's' : ''}`);
        const worldBuild: WorldBuild = {
          kind: 'world_build',
          id: worldBuildId,
          summary: `World created: ${parts.join(', ')}`,
          expansionManifest: {
            characters: allChars,
            locations: allLocs,
            threads: allThreads,
            relationships: n.relationships,
            worldKnowledge: {
              addedNodes: Object.values(n.worldKnowledge?.nodes ?? {}).map((node) => ({ id: node.id, concept: node.concept, type: node.type })),
              addedEdges: (n.worldKnowledge?.edges ?? []).map((edge) => ({ from: edge.from, to: edge.to, relation: edge.relation })),
            },
            artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
          },
        };

        // Prepend the world-build commit before existing entries in the branch
        n.worldBuilds[worldBuildId] = worldBuild;
        n.branches[rootBranch.id] = {
          ...rootBranch,
          entryIds: [worldBuildId, ...rootBranch.entryIds],
        };
      }

      const newBranchId = getRootBranchId(n);
      const newResolved = getResolvedKeys(n, newBranchId);
      const derived = withDerivedEntities(n, newResolved ?? []);

      const entry = narrativeToEntry(derived);
      // Persistence handled by effects watching activeNarrative
      return {
        ...state,
        narratives: [...state.narratives, entry],
        activeNarrativeId: derived.id,
        activeNarrative: derived,
        activeBranchId: newBranchId,
        resolvedEntryKeys: newResolved,
        currentSceneIndex: Math.max(0, newResolved.length - 1),
        wizardOpen: false,
      };
    }
    case 'DELETE_NARRATIVE': {
      const isSeed = SEED_IDS.has(action.id);
      const isActive = state.activeNarrativeId === action.id;

      // Fire-and-forget async delete
      deletePersisted(action.id).catch((err) => {
        logError('Failed to delete narrative from storage', err, {
          source: 'other',
          operation: 'delete-narrative',
          details: { narrativeId: action.id }
        });
      });
      deleteApiLogs(action.id).catch((err) => {
        logError('Failed to delete API logs from storage', err, {
          source: 'other',
          operation: 'delete-api-logs',
          details: { narrativeId: action.id }
        });
      });
      // Delete associated assets (audio, embeddings, images)
      assetManager.init()
        .then(() => assetManager.deleteNarrativeAssets(action.id))
        .catch((err) => {
          logError('Failed to delete narrative assets', err, {
            source: 'other',
            operation: 'delete-narrative-assets',
            details: { narrativeId: action.id }
          });
        });

      if (isSeed) {
        // Reset seed to original bundled data instead of removing it
        const originalSeed = bundledNarratives.get(action.id);
        if (!originalSeed) return state;
        const resetEntry = narrativeToEntry(originalSeed);
        return {
          ...state,
          narratives: state.narratives.map((n) => n.id === action.id ? resetEntry : n),
          activeNarrativeId: isActive ? null : state.activeNarrativeId,
          activeNarrative: isActive ? null : state.activeNarrative,
        };
      }

      return {
        ...state,
        narratives: state.narratives.filter(n => n.id !== action.id),
        activeNarrativeId: isActive ? null : state.activeNarrativeId,
        activeNarrative: isActive ? null : state.activeNarrative,
      };
    }
    case 'SELECT_KNOWLEDGE_ENTITY':
      return { ...state, selectedKnowledgeEntity: action.entityId, selectedThreadLog: null };
    case 'SELECT_THREAD_LOG':
      return { ...state, selectedThreadLog: action.threadId, selectedKnowledgeEntity: null };
    case 'SET_GRAPH_VIEW_MODE':
      return { ...state, graphViewMode: action.mode, selectedThreadLog: null, selectedKnowledgeEntity: null };

    case 'SET_SEARCH_QUERY':
      return {
        ...state,
        currentSearchQuery: action.query,
        currentResultIndex: 0,
        searchFocusMode: true,
      };

    case 'SET_SEARCH_RESULT_INDEX':
      return {
        ...state,
        currentResultIndex: action.index,
      };

    case 'CLEAR_SEARCH':
      return {
        ...state,
        currentSearchQuery: null,
        currentResultIndex: 0,
        searchFocusMode: false,
      };

    case 'TOGGLE_SEARCH_FOCUS':
      return {
        ...state,
        searchFocusMode: !state.searchFocusMode,
      };

    case 'SWITCH_BRANCH': {
      if (!state.activeNarrative) return state;
      const resolved = getResolvedKeys(state.activeNarrative, action.branchId);
      const derived = withDerivedEntities(state.activeNarrative, resolved);
      return {
        ...state,
        activeNarrative: derived,
        activeBranchId: action.branchId,
        resolvedEntryKeys: resolved,
        currentSceneIndex: resolved.length - 1,
        inspectorContext: resolved.length > 0
          ? { type: 'scene' as const, sceneId: resolved[resolved.length - 1] }
          : null,
        selectedKnowledgeEntity: null,
        selectedThreadLog: null,
      };
    }

    // ── CRUD: Scenes ──────────────────────────────────────────────────────
    case 'UPDATE_SCENE':
      return updateNarrative(state, (n) => {
        const scene = n.scenes[action.sceneId];
        if (!scene) return n;

        const updates = { ...action.updates };
        let updatedScene = { ...scene };
        const versionType = action.versionType ?? 'generate';

        // Get current resolved version (from pointer or latest for this branch)
        const branch = state.activeBranchId ? n.branches[state.activeBranchId] : undefined;
        const currentProsePointer = branch?.versionPointers?.[scene.id]?.proseVersion;
        const currentPlanPointer = branch?.versionPointers?.[scene.id]?.planVersion;

        // Helper to compute next version number
        // Version hierarchy: generate (major) → rewrite (minor) → edit (sub-minor)
        // E.g., 1 → 1.1 → 1.1.1, 1.1.2 → 1.2 → 2 → 2.1 → 2.1.1
        // IMPORTANT: Version numbers are GLOBALLY unique across all branches.
        // Even if user is on V1.2 and V1.3 exists elsewhere, new rewrite creates V1.4
        const computeNextVersion = (
          allVersions: { version: string; branchId: string; versionType: string }[],
          _branchId: string,
          type: 'generate' | 'rewrite' | 'edit',
          currentVersion?: string, // The version currently being viewed/edited
        ): { version: string; parentVersion?: string } => {
          // Sort versions: highest first by major, then minor, then edit
          const sortVersions = (vList: typeof allVersions) => {
            return [...vList].sort((a, b) => {
              const aParts = a.version.split('.').map(Number);
              const bParts = b.version.split('.').map(Number);
              for (let i = 0; i < 3; i++) {
                const av = aParts[i] ?? 0;
                const bv = bParts[i] ?? 0;
                if (av !== bv) return bv - av;
              }
              return 0;
            });
          };

          // Parse version string into parts
          const parseVersion = (v: string) => {
            const parts = v.split('.').map(Number);
            return {
              major: parts[0] ?? 0,
              minor: parts[1] ?? 0,
              edit: parts[2] ?? 0,
            };
          };

          // Get the current version's parts (if specified)
          const current = currentVersion ? parseVersion(currentVersion) : null;

          if (type === 'generate') {
            // Fresh generation: find highest major version GLOBALLY, increment
            let maxMajor = 0;
            for (const v of allVersions) {
              const major = parseInt(v.version.split('.')[0], 10);
              if (!isNaN(major) && major > maxMajor) maxMajor = major;
            }
            return { version: String(maxMajor + 1), parentVersion: currentVersion };
          } else if (type === 'rewrite') {
            // Rewrite: increment minor at the CURRENT major level, but check for existing higher minors
            if (allVersions.length === 0) {
              return { version: '1.1', parentVersion: undefined };
            }

            // Use current version's major, or latest if none specified
            const sorted = sortVersions(allVersions);
            const targetMajor = current?.major ?? parseVersion(sorted[0].version).major;

            // Find highest minor at this major level (across all branches)
            let maxMinor = 0;
            for (const v of allVersions) {
              const parts = parseVersion(v.version);
              if (parts.major === targetMajor && parts.minor > maxMinor) {
                maxMinor = parts.minor;
              }
            }

            return { version: `${targetMajor}.${maxMinor + 1}`, parentVersion: currentVersion };
          } else {
            // Edit: increment sub-minor at the CURRENT major.minor level, check for existing higher edits
            if (allVersions.length === 0) {
              return { version: '1.0.1', parentVersion: undefined };
            }

            // Use current version's major.minor, or latest if none specified
            const sorted = sortVersions(allVersions);
            const latest = parseVersion(sorted[0].version);
            const targetMajor = current?.major ?? latest.major;
            const targetMinor = current?.minor ?? latest.minor;

            // Find highest edit at this major.minor level (across all branches)
            let maxEdit = 0;
            for (const v of allVersions) {
              const parts = parseVersion(v.version);
              if (parts.major === targetMajor && parts.minor === targetMinor && parts.edit > maxEdit) {
                maxEdit = parts.edit;
              }
            }

            return { version: `${targetMajor}.${targetMinor}.${maxEdit + 1}`, parentVersion: currentVersion };
          }
        };

        // Handle prose versioning — append to version array instead of overwriting
        let newProseVersion: string | undefined;
        if (updates.prose !== undefined && state.activeBranchId) {
          const { version, parentVersion } = computeNextVersion(
            scene.proseVersions ?? [],
            state.activeBranchId,
            versionType,
            currentProsePointer, // Use pointer if user pinned a specific version
          );
          const newVersion = {
            prose: updates.prose,
            beatProseMap: updates.beatProseMap,
            proseScore: updates.proseScore,
            branchId: state.activeBranchId,
            timestamp: Date.now(),
            version,
            versionType,
            parentVersion,
            sourcePlanVersion: action.sourcePlanVersion,
          };
          updatedScene.proseVersions = [...(scene.proseVersions ?? []), newVersion];
          // Auto-update version pointer to point to the new version
          newProseVersion = version;
          // Remove from direct updates — no longer writing to legacy fields
          delete updates.prose;
          delete updates.beatProseMap;
          delete updates.proseScore;
        }

        // Handle plan versioning — append to version array instead of overwriting
        let newPlanVersion: string | undefined;
        if (updates.plan !== undefined && state.activeBranchId) {
          const { version, parentVersion } = computeNextVersion(
            scene.planVersions ?? [],
            state.activeBranchId,
            versionType,
            currentPlanPointer, // Use pointer if user pinned a specific version
          );
          const newVersion = {
            plan: updates.plan,
            branchId: state.activeBranchId,
            timestamp: Date.now(),
            version,
            versionType,
            parentVersion,
          };
          updatedScene.planVersions = [...(scene.planVersions ?? []), newVersion];
          // Auto-update version pointer to point to the new version
          newPlanVersion = version;
          delete updates.plan;
        }

        // Apply remaining updates (non-versioned fields like summary, events, mutations, etc.)
        updatedScene = { ...updatedScene, ...updates };

        // Update version pointers to point to newly created versions
        let updatedBranches = n.branches;
        if (state.activeBranchId && (newProseVersion || newPlanVersion)) {
          const currentBranch = n.branches[state.activeBranchId];
          if (currentBranch) {
            const currentPointers = currentBranch.versionPointers?.[action.sceneId] ?? {};
            const updatedPointers = {
              ...currentPointers,
              ...(newProseVersion ? { proseVersion: newProseVersion } : {}),
              ...(newPlanVersion ? { planVersion: newPlanVersion } : {}),
            };
            updatedBranches = {
              ...n.branches,
              [state.activeBranchId]: {
                ...currentBranch,
                versionPointers: {
                  ...currentBranch.versionPointers,
                  [action.sceneId]: updatedPointers,
                },
              },
            };
          }
        }

        return { ...n, scenes: { ...n.scenes, [action.sceneId]: updatedScene }, branches: updatedBranches };
      });

    case 'DELETE_SCENE': {
      const newState = updateNarrative(state, (n) => {
        const { [action.sceneId]: _, ...restScenes } = n.scenes;
        const { [action.sceneId]: __, ...restWorldBuilds } = n.worldBuilds;
        const branch = n.branches[action.branchId];
        const updatedBranches = branch
          ? { ...n.branches, [action.branchId]: { ...branch, entryIds: branch.entryIds.filter((s) => s !== action.sceneId) } }
          : n.branches;
        const updatedArcs = Object.fromEntries(
          Object.entries(n.arcs).map(([id, arc]) => [id, { ...arc, sceneIds: arc.sceneIds.filter((s) => s !== action.sceneId) }]),
        );
        return { ...n, scenes: restScenes, worldBuilds: restWorldBuilds, branches: updatedBranches, arcs: updatedArcs };
      });
      if (newState.activeNarrative && newState.activeBranchId) {
        const resolved = getResolvedKeys(newState.activeNarrative, newState.activeBranchId);
        return { ...newState, resolvedEntryKeys: resolved, currentSceneIndex: Math.min(newState.currentSceneIndex, resolved.length - 1) };
      }
      return newState;
    }


    // ── CRUD: Branches ────────────────────────────────────────────────────
    case 'CREATE_BRANCH': {
      const newState = updateNarrative(state, (n) => ({
        ...n, branches: { ...n.branches, [action.branch.id]: action.branch },
      }));
      if (newState.activeNarrative) {
        const resolved = getResolvedKeys(newState.activeNarrative, action.branch.id);
        return { ...newState, activeBranchId: action.branch.id, resolvedEntryKeys: resolved, currentSceneIndex: resolved.length - 1 };
      }
      return newState;
    }

    case 'DELETE_BRANCH': {
      if (action.branchId === state.activeBranchId) return state;
      // Build full cascade set (branch + all child branches)
      const toDelete = new Set<string>();
      if (state.activeNarrative) {
        const queue = [action.branchId];
        while (queue.length > 0) {
          const id = queue.pop()!;
          toDelete.add(id);
          Object.values(state.activeNarrative.branches).forEach((b) => {
            if (b.parentBranchId === id) queue.push(b.id);
          });
        }
      }
      if (state.activeBranchId && toDelete.has(state.activeBranchId)) return state;

      const result = updateNarrative(state, (n) => {
        const remaining = Object.fromEntries(
          Object.entries(n.branches).filter(([id]) => !toDelete.has(id)),
        );

        // Entries owned exclusively by deleted branches (not shared with survivors)
        const deletedEntries = new Set<string>();
        toDelete.forEach((bid) => n.branches[bid]?.entryIds.forEach((eid) => deletedEntries.add(eid)));
        const survivingEntries = new Set<string>();
        Object.values(remaining).forEach((b) => b.entryIds.forEach((eid) => survivingEntries.add(eid)));
        const entriesToRemove = new Set([...deletedEntries].filter((eid) => !survivingEntries.has(eid)));

        const scenes = Object.fromEntries(Object.entries(n.scenes).filter(([id]) => !entriesToRemove.has(id)));
        const worldBuilds = Object.fromEntries(Object.entries(n.worldBuilds).filter(([id]) => !entriesToRemove.has(id)));

        // Clean up arcs: remove deleted scene IDs, drop arcs that become empty
        const arcs = Object.fromEntries(
          Object.entries(n.arcs).flatMap(([id, arc]) => {
            const sceneIds = arc.sceneIds.filter((sid) => !entriesToRemove.has(sid));
            return sceneIds.length === 0 ? [] : [[id, { ...arc, sceneIds }]];
          }),
        );

        return { ...n, branches: remaining, scenes, worldBuilds, arcs };
      });

      if (result.activeNarrative && result.activeBranchId) {
        const resolved = getResolvedKeys(result.activeNarrative, result.activeBranchId);
        const derived = withDerivedEntities(result.activeNarrative, resolved);
        return { ...result, activeNarrative: derived, resolvedEntryKeys: resolved };
      }
      return result;
    }

    case 'RENAME_BRANCH':
      return updateNarrative(state, (n) => {
        const branch = n.branches[action.branchId];
        if (!branch) return n;
        return { ...n, branches: { ...n.branches, [action.branchId]: { ...branch, name: action.name } } };
      });

    case 'SET_VERSION_POINTER':
      return updateNarrative(state, (n) => {
        const branch = n.branches[action.branchId];
        if (!branch) return n;

        const existingPointers = branch.versionPointers ?? {};
        const scenePointers = existingPointers[action.sceneId] ?? {};

        // Update or clear the pointer
        const updatedScenePointers = action.pointerType === 'prose'
          ? { ...scenePointers, proseVersion: action.version }
          : { ...scenePointers, planVersion: action.version };

        // Clean up undefined values
        if (updatedScenePointers.proseVersion === undefined) delete updatedScenePointers.proseVersion;
        if (updatedScenePointers.planVersion === undefined) delete updatedScenePointers.planVersion;

        // Clean up empty scene pointers
        const updatedPointers = { ...existingPointers };
        if (Object.keys(updatedScenePointers).length === 0) {
          delete updatedPointers[action.sceneId];
        } else {
          updatedPointers[action.sceneId] = updatedScenePointers;
        }

        // Clean up empty versionPointers
        const updatedBranch = {
          ...branch,
          versionPointers: Object.keys(updatedPointers).length > 0 ? updatedPointers : undefined,
        };

        return { ...n, branches: { ...n.branches, [action.branchId]: updatedBranch } };
      });

    case 'REMOVE_BRANCH_ENTRY': {
      // Remove an entry from a branch's entryIds without deleting the scene itself.
      // Used when the scene is referenced by other branches.
      const newState = updateNarrative(state, (n) => {
        const branch = n.branches[action.branchId];
        if (!branch) return n;
        return {
          ...n,
          branches: {
            ...n.branches,
            [action.branchId]: { ...branch, entryIds: branch.entryIds.filter((id) => id !== action.entryId) },
          },
        };
      });
      if (newState.activeNarrative && newState.activeBranchId) {
        const resolved = getResolvedKeys(newState.activeNarrative, newState.activeBranchId);
        const derived = withDerivedEntities(newState.activeNarrative, resolved);
        return { ...newState, activeNarrative: derived, resolvedEntryKeys: resolved };
      }
      return newState;
    }

    case 'SET_STRUCTURE_REVIEW':
      return updateNarrative(state, (n) => ({
        ...n,
        structureReviews: { ...n.structureReviews, [action.branchId]: action.evaluation },
      }));

    case 'SET_PROSE_EVALUATION':
      return updateNarrative(state, (n) => ({
        ...n,
        proseEvaluations: { ...n.proseEvaluations, [action.branchId]: action.evaluation },
      }));

    case 'SET_PLAN_EVALUATION':
      return updateNarrative(state, (n) => ({
        ...n,
        planEvaluations: { ...n.planEvaluations, [action.branchId]: action.evaluation },
      }));

    case 'RECONSTRUCT_BRANCH': {
      return updateNarrative(state, (n) => {
        const newScenes = { ...n.scenes };
        for (const scene of action.scenes) newScenes[scene.id] = scene;
        // Merge arcs: for existing arcs, append new sceneIds without removing originals.
        // This prevents reconstruction from mutating arcs shared by the parent branch.
        const newArcs = { ...n.arcs };
        for (const [arcId, arc] of Object.entries(action.arcs)) {
          const existing = newArcs[arcId];
          if (!existing) {
            newArcs[arcId] = arc;
          } else {
            // Merge: keep original sceneIds and add any new ones from reconstruction
            const merged = new Set([...existing.sceneIds, ...arc.sceneIds]);
            newArcs[arcId] = { ...existing, sceneIds: [...merged] };
          }
        }
        return { ...n, scenes: newScenes, arcs: newArcs };
      });
    }

    // ── Bulk: AI-generated scenes ─────────────────────────────────────────
    case 'BULK_ADD_SCENES': {
      const newState = updateNarrative(state, (n) => {
        const newScenes = { ...n.scenes };
        for (const scene of action.scenes) {
          newScenes[scene.id] = scene;
        }

        const newSceneIds = action.scenes.map((s) => s.id);
        const updatedArcs = { ...n.arcs };
        if (!updatedArcs[action.arc.id]) {
          updatedArcs[action.arc.id] = action.arc;
        } else {
          const existing = updatedArcs[action.arc.id];
          const existingSet = new Set(existing.sceneIds);
          const deduped = newSceneIds.filter((id) => !existingSet.has(id));
          updatedArcs[action.arc.id] = { ...existing, sceneIds: [...existing.sceneIds, ...deduped] };
        }
        const branch = n.branches[action.branchId];
        const existingEntrySet = branch ? new Set(branch.entryIds) : new Set<string>();
        const dedupedEntries = newSceneIds.filter((id) => !existingEntrySet.has(id));

        // Auto-increment planning queue scene count
        let updatedBranch = branch
          ? { ...branch, entryIds: [...branch.entryIds, ...dedupedEntries] }
          : null;
        if (updatedBranch?.planningQueue) {
          const queue = updatedBranch.planningQueue;
          const activePhase = queue.phases[queue.activePhaseIndex];
          if (activePhase && activePhase.status === 'active') {
            const phases = [...queue.phases];
            phases[queue.activePhaseIndex] = {
              ...activePhase,
              scenesCompleted: activePhase.scenesCompleted + action.scenes.length,
            };
            updatedBranch = { ...updatedBranch, planningQueue: { ...queue, phases } };
          }
        }

        const updatedBranches = updatedBranch
          ? { ...n.branches, [action.branchId]: updatedBranch }
          : n.branches;
        return { ...n, scenes: newScenes, arcs: updatedArcs, branches: updatedBranches };
      });
      if (newState.activeNarrative && newState.activeBranchId) {
        const resolved = getResolvedKeys(newState.activeNarrative, newState.activeBranchId);
        const derived = withDerivedEntities(newState.activeNarrative, resolved);
        return { ...newState, activeNarrative: derived, resolvedEntryKeys: resolved };
      }
      return newState;
    }

    // ── Expand World: merge new elements + create world build ─────
    case 'EXPAND_WORLD': {
      const worldBuildId = action.worldBuildId;

      // Build summary from expansion contents
      const charNames = action.characters.map((c) => c.name);
      const locNames = action.locations.map((l) => l.name);
      const threadDescs = action.threads.map((t) => t.description);
      const parts: string[] = [];
      const wkNodeCount = action.worldKnowledgeMutations?.addedNodes?.length ?? 0;
      const wkEdgeCount = action.worldKnowledgeMutations?.addedEdges?.length ?? 0;
      if (charNames.length > 0) parts.push(`${charNames.length} character${charNames.length > 1 ? 's' : ''} (${charNames.join(', ')})`);
      if (locNames.length > 0) parts.push(`${locNames.length} location${locNames.length > 1 ? 's' : ''} (${locNames.join(', ')})`);
      if (threadDescs.length > 0) parts.push(`${threadDescs.length} thread${threadDescs.length > 1 ? 's' : ''}`);
      const artifactNames = (action.artifacts ?? []).map((a) => a.name);
      if (action.relationships.length > 0) parts.push(`${action.relationships.length} relationship${action.relationships.length > 1 ? 's' : ''}`);
      if (artifactNames.length > 0) parts.push(`${artifactNames.length} artifact${artifactNames.length > 1 ? 's' : ''} (${artifactNames.join(', ')})`);
      if (wkNodeCount > 0) parts.push(`${wkNodeCount} knowledge node${wkNodeCount > 1 ? 's' : ''} (${action.worldKnowledgeMutations!.addedNodes.map((n) => n.concept).join(', ')})`);
      if (wkEdgeCount > 0) parts.push(`${wkEdgeCount} knowledge edge${wkEdgeCount > 1 ? 's' : ''}`);
      const worldBuildSummary = parts.length > 0 ? `World expanded: added ${parts.join(', ')}` : 'World expansion (no new elements)';

      // Build manifest worldKnowledge: explicit mutations + auto-generated nodes for threads/locations
      const autoNodes: WorldKnowledgeMutation['addedNodes'] = [];
      let autoCounter = 0;
      for (const t of action.threads) {
        const covered = (action.worldKnowledgeMutations?.addedNodes ?? []).some((nd) => nd.concept === t.description);
        if (!covered) autoNodes.push({ id: `${worldBuildId}-T${++autoCounter}`, concept: t.description, type: 'concept' as const });
      }
      for (const l of action.locations) {
        const covered = (action.worldKnowledgeMutations?.addedNodes ?? []).some((nd) => nd.concept === l.name);
        if (!covered) autoNodes.push({ id: `${worldBuildId}-L${++autoCounter}`, concept: l.name, type: 'concept' as const });
      }
      const manifestWK: WorldKnowledgeMutation = {
        addedNodes: [...(action.worldKnowledgeMutations?.addedNodes ?? []), ...autoNodes],
        addedEdges: action.worldKnowledgeMutations?.addedEdges ?? [],
      };

      const worldBuild: WorldBuild = {
        kind: 'world_build',
        id: worldBuildId,
        summary: worldBuildSummary,
        expansionManifest: {
          characters: action.characters,
          locations: action.locations,
          threads: action.threads.map((t) => ({ ...t, openedAt: worldBuildId })),
          relationships: action.relationships,
          worldKnowledge: manifestWK,
          artifacts: action.artifacts ?? [],
          ownershipMutations: action.ownershipMutations,
          tieMutations: action.tieMutations,
          continuityMutations: action.continuityMutations,
          relationshipMutations: action.relationshipMutations,
        },
      };

      const newState = updateNarrative(state, (n) => {
        // Idempotent: skip if this world build was already applied
        if (n.worldBuilds[worldBuildId]) return n;

        const branch = n.branches[action.branchId];
        const updatedBranches = branch
          ? { ...n.branches, [action.branchId]: { ...branch, entryIds: [...branch.entryIds, worldBuildId] } }
          : n.branches;

        return {
          ...n,
          worldBuilds: { ...n.worldBuilds, [worldBuildId]: worldBuild },
          branches: updatedBranches,
        };
      });

      if (newState.activeNarrative && newState.activeBranchId) {
        const resolved = getResolvedKeys(newState.activeNarrative, newState.activeBranchId);
        const derived = withDerivedEntities(newState.activeNarrative, resolved);
        return { ...newState, activeNarrative: derived, resolvedEntryKeys: resolved };
      }
      return newState;
    }

    // ── Auto mode ──────────────────────────────────────────────────────────
    case 'SET_AUTO_CONFIG':
      return { ...state, autoConfig: action.config };

    case 'START_AUTO_RUN':
      return {
        ...state,
        autoRunState: {
          isRunning: true,
          isPaused: false,
          currentCycle: 0,
          consecutiveFailures: 0,
          statusMessage: 'Starting...',
          totalScenesGenerated: 0,
          totalWorldExpansions: 0,
          startingSceneCount: state.resolvedEntryKeys.length,
          startingArcCount: state.activeNarrative ? Object.keys(state.activeNarrative.arcs).length : 0,
          log: [],
        },
      };

    case 'PAUSE_AUTO_RUN':
      return state.autoRunState
        ? { ...state, autoRunState: { ...state.autoRunState, isPaused: true, isRunning: false } }
        : state;

    case 'RESUME_AUTO_RUN':
      return state.autoRunState
        ? { ...state, autoRunState: { ...state.autoRunState, isPaused: false, isRunning: true } }
        : state;

    case 'STOP_AUTO_RUN':
      return { ...state, autoRunState: null };

    case 'SET_AUTO_STATUS':
      return state.autoRunState
        ? { ...state, autoRunState: { ...state.autoRunState, statusMessage: action.message } }
        : state;

    case 'LOG_AUTO_CYCLE':
      return state.autoRunState
        ? {
            ...state,
            autoRunState: {
              ...state.autoRunState,
              currentCycle: state.autoRunState.currentCycle + 1,
              consecutiveFailures: action.entry.error
                ? state.autoRunState.consecutiveFailures + 1
                : 0,
              totalScenesGenerated: state.autoRunState.totalScenesGenerated + action.entry.scenesGenerated,
              totalWorldExpansions: state.autoRunState.totalWorldExpansions + (action.entry.worldExpanded ? 1 : 0),
              log: [...state.autoRunState.log, action.entry],
            },
          }
        : state;

    case 'LOG_API_CALL':
      return { ...state, apiLogs: [...state.apiLogs, action.entry] };

    case 'UPDATE_API_LOG':
      return {
        ...state,
        apiLogs: state.apiLogs.map((l) =>
          l.id === action.id ? { ...l, ...action.updates } : l,
        ),
      };

    case 'CLEAR_API_LOGS':
      return { ...state, apiLogs: [] };

    case 'LOG_SYSTEM':
      return { ...state, systemLogs: [...state.systemLogs, action.entry] };

    case 'CLEAR_SYSTEM_LOGS':
      return { ...state, systemLogs: [] };

    case 'SET_COVER_IMAGE': {
      // Update the narrative entry in the list
      const updatedNarratives = state.narratives.map((e) =>
        e.id === action.narrativeId ? { ...e, coverImageUrl: action.imageUrl } : e,
      );
      // If this is the active narrative, update it too
      if (state.activeNarrative && state.activeNarrative.id === action.narrativeId) {
        const updatedActive = { ...state.activeNarrative, coverImageUrl: action.imageUrl };
        return { ...state, narratives: updatedNarratives, activeNarrative: updatedActive };
      }
      // For non-active narratives, persist directly
      loadNarrative(action.narrativeId).then((stored) => {
        if (stored) persistNarrative({ ...stored, coverImageUrl: action.imageUrl });
      }).catch((err) => {
        logError('Failed to update cover image in storage', err, {
          source: 'other',
          operation: 'update-cover-image',
          details: { narrativeId: action.narrativeId }
        });
      });
      return { ...state, narratives: updatedNarratives };
    }

    case 'UPDATE_NARRATIVE_META': {
      const metaUpdates: Partial<{ title: string; description: string }> = {};
      if (action.title !== undefined) metaUpdates.title = action.title;
      if (action.description !== undefined) metaUpdates.description = action.description;
      const updatedNarratives = state.narratives.map((e) =>
        e.id === action.narrativeId ? { ...e, ...metaUpdates } : e,
      );
      if (state.activeNarrative && state.activeNarrative.id === action.narrativeId) {
        const updatedActive = { ...state.activeNarrative, ...metaUpdates };
        return { ...state, narratives: updatedNarratives, activeNarrative: updatedActive };
      }
      loadNarrative(action.narrativeId).then((stored) => {
        if (stored) persistNarrative({ ...stored, ...metaUpdates });
      }).catch((err) => {
        logError('Failed to update narrative metadata in storage', err, {
          source: 'other',
          operation: 'update-narrative-meta',
          details: { narrativeId: action.narrativeId }
        });
      });
      return { ...state, narratives: updatedNarratives };
    }

    case 'SET_SCENE_IMAGE':
      return updateNarrative(state, (n) => {
        const scene = n.scenes[action.sceneId];
        if (!scene) return n;
        return { ...n, scenes: { ...n.scenes, [action.sceneId]: { ...scene, imageUrl: action.imageUrl } } };
      });

    case 'SET_SCENE_AUDIO':
      return updateNarrative(state, (n) => {
        const scene = n.scenes[action.sceneId];
        if (!scene) return n;
        return { ...n, scenes: { ...n.scenes, [action.sceneId]: { ...scene, audioUrl: action.audioUrl } } };
      });

    case 'CLEAR_SCENE_AUDIO':
      return updateNarrative(state, (n) => {
        const scene = n.scenes[action.sceneId];
        if (!scene) return n;
        const { audioUrl: _, ...rest } = scene;
        return { ...n, scenes: { ...n.scenes, [action.sceneId]: rest } };
      });

    case 'SET_CHARACTER_IMAGE': {
      const afterUpdate = updateNarrative(state, (n) => {
        const worldBuildEntry = Object.values(n.worldBuilds).find((wb) =>
          wb.expansionManifest.characters.some((c) => c.id === action.characterId)
        );
        if (!worldBuildEntry) return n;
        return {
          ...n,
          worldBuilds: {
            ...n.worldBuilds,
            [worldBuildEntry.id]: {
              ...worldBuildEntry,
              expansionManifest: {
                ...worldBuildEntry.expansionManifest,
                characters: worldBuildEntry.expansionManifest.characters.map((c) =>
                  c.id === action.characterId ? { ...c, imageUrl: action.imageUrl } : c
                ),
              },
            },
          },
        };
      });
      if (!afterUpdate.activeNarrative) return afterUpdate;
      const derived = withDerivedEntities(afterUpdate.activeNarrative, afterUpdate.resolvedEntryKeys);
      return { ...afterUpdate, activeNarrative: derived };
    }

    case 'SET_LOCATION_IMAGE': {
      const afterUpdate = updateNarrative(state, (n) => {
        const worldBuildEntry = Object.values(n.worldBuilds).find((wb) =>
          wb.expansionManifest.locations.some((l) => l.id === action.locationId)
        );
        if (!worldBuildEntry) return n;
        return {
          ...n,
          worldBuilds: {
            ...n.worldBuilds,
            [worldBuildEntry.id]: {
              ...worldBuildEntry,
              expansionManifest: {
                ...worldBuildEntry.expansionManifest,
                locations: worldBuildEntry.expansionManifest.locations.map((l) =>
                  l.id === action.locationId ? { ...l, imageUrl: action.imageUrl } : l
                ),
              },
            },
          },
        };
      });
      if (!afterUpdate.activeNarrative) return afterUpdate;
      const derived = withDerivedEntities(afterUpdate.activeNarrative, afterUpdate.resolvedEntryKeys);
      return { ...afterUpdate, activeNarrative: derived };
    }

    case 'SET_ARTIFACT_IMAGE': {
      const afterUpdate = updateNarrative(state, (n) => {
        const worldBuildEntry = Object.values(n.worldBuilds).find((wb) =>
          (wb.expansionManifest.artifacts ?? []).some((a) => a.id === action.artifactId)
        );
        if (!worldBuildEntry) return n;
        return {
          ...n,
          worldBuilds: {
            ...n.worldBuilds,
            [worldBuildEntry.id]: {
              ...worldBuildEntry,
              expansionManifest: {
                ...worldBuildEntry.expansionManifest,
                artifacts: (worldBuildEntry.expansionManifest.artifacts ?? []).map((a) =>
                  a.id === action.artifactId ? { ...a, imageUrl: action.imageUrl } : a
                ),
              },
            },
          },
        };
      });
      if (!afterUpdate.activeNarrative) return afterUpdate;
      const derived = withDerivedEntities(afterUpdate.activeNarrative, afterUpdate.resolvedEntryKeys);
      return { ...afterUpdate, activeNarrative: derived };
    }

    case 'SET_IMAGE_STYLE':
      return updateNarrative(state, (n) => ({ ...n, imageStyle: action.style }));

    case 'SET_RULES':
      return updateNarrative(state, (n) => ({ ...n, rules: action.rules }));

    case 'SET_WORLD_SYSTEMS':
      return updateNarrative(state, (n) => ({ ...n, worldSystems: action.systems }));

    case 'SET_STORY_SETTINGS':
      return updateNarrative(state, (n) => ({ ...n, storySettings: action.settings }));

    case 'SET_PROSE_PROFILE':
      return updateNarrative(state, (n) => ({ ...n, proseProfile: action.profile }));

    case 'SET_BEAT_PROFILE_PRESETS':
      return { ...state, beatProfilePresets: action.presets };

    case 'SET_MECHANISM_PROFILE_PRESETS':
      return { ...state, mechanismProfilePresets: action.presets };

    // ── Analysis ──────────────────────────────────────────────────────────
    case 'ADD_ANALYSIS_JOB':
      return { ...state, analysisJobs: [...state.analysisJobs, action.job] };

    case 'UPDATE_ANALYSIS_JOB':
      return {
        ...state,
        analysisJobs: state.analysisJobs.map((j) =>
          j.id === action.id ? { ...j, ...action.updates, updatedAt: Date.now() } : j,
        ),
      };

    case 'DELETE_ANALYSIS_JOB':
      return { ...state, analysisJobs: state.analysisJobs.filter((j) => j.id !== action.id) };

    case 'HYDRATE_ANALYSIS_JOBS': {
      // Merge: keep any in-memory jobs created before hydration completed (race condition guard)
      const hydratedIds = new Set(action.jobs.map((j) => j.id));
      const inMemoryOnly = state.analysisJobs.filter((j) => !hydratedIds.has(j.id));
      return { ...state, analysisJobs: [...action.jobs, ...inMemoryOnly] };
    }

    // ── Chat threads ──────────────────────────────────────────────────────
    case 'CREATE_CHAT_THREAD': {
      const withThread = updateNarrative(state, (n) => ({
        ...n,
        chatThreads: { ...(n.chatThreads ?? {}), [action.thread.id]: action.thread },
      }));
      return { ...withThread, activeChatThreadId: action.thread.id };
    }

    case 'DELETE_CHAT_THREAD': {
      const withoutThread = updateNarrative(state, (n) => {
        const { [action.threadId]: _, ...rest } = n.chatThreads ?? {};
        return { ...n, chatThreads: rest };
      });
      let nextActive = state.activeChatThreadId;
      if (state.activeChatThreadId === action.threadId) {
        const remaining = Object.values(withoutThread.activeNarrative?.chatThreads ?? {});
        remaining.sort((a, b) => b.updatedAt - a.updatedAt);
        nextActive = remaining[0]?.id ?? null;
      }
      return { ...withoutThread, activeChatThreadId: nextActive };
    }

    case 'RENAME_CHAT_THREAD':
      return updateNarrative(state, (n) => {
        const thread = n.chatThreads?.[action.threadId];
        if (!thread) return n;
        return { ...n, chatThreads: { ...(n.chatThreads ?? {}), [action.threadId]: { ...thread, name: action.name } } };
      });

    case 'SET_ACTIVE_CHAT_THREAD':
      return { ...state, activeChatThreadId: action.threadId };

    case 'UPSERT_CHAT_THREAD':
      return updateNarrative(state, (n) => {
        const thread = (n.chatThreads ?? {})[action.threadId];
        if (!thread) return n;
        return {
          ...n,
          chatThreads: {
            ...(n.chatThreads ?? {}),
            [action.threadId]: {
              ...thread,
              messages: action.messages,
              ...(action.name ? { name: action.name } : {}),
              updatedAt: Date.now(),
            },
          },
        };
      });

    case 'CREATE_NOTE': {
      const withNote = updateNarrative(state, (n) => ({
        ...n,
        notes: { ...(n.notes ?? {}), [action.note.id]: action.note },
      }));
      return { ...withNote, activeNoteId: action.note.id };
    }

    case 'DELETE_NOTE': {
      const withoutNote = updateNarrative(state, (n) => {
        const { [action.noteId]: _, ...rest } = n.notes ?? {};
        return { ...n, notes: rest };
      });
      let nextActiveNote = state.activeNoteId;
      if (state.activeNoteId === action.noteId) {
        const remaining = Object.values(withoutNote.activeNarrative?.notes ?? {});
        remaining.sort((a, b) => b.updatedAt - a.updatedAt);
        nextActiveNote = remaining[0]?.id ?? null;
      }
      return { ...withoutNote, activeNoteId: nextActiveNote };
    }

    case 'UPDATE_NOTE':
      return updateNarrative(state, (n) => {
        const note = n.notes?.[action.noteId];
        if (!note) return n;
        return {
          ...n,
          notes: {
            ...(n.notes ?? {}),
            [action.noteId]: {
              ...note,
              ...(action.title !== undefined ? { title: action.title } : {}),
              ...(action.content !== undefined ? { content: action.content } : {}),
              updatedAt: Date.now(),
            },
          },
        };
      });

    case 'SET_ACTIVE_NOTE':
      return { ...state, activeNoteId: action.noteId };

    // ── Planning Queue ────────────────────────────────────────────────────
    case 'SET_PLANNING_QUEUE':
      return updateNarrative(state, (n) => {
        const branch = n.branches[action.branchId];
        if (!branch) return n;
        return {
          ...n,
          branches: { ...n.branches, [action.branchId]: { ...branch, planningQueue: action.queue } },
        };
      });

    case 'UPDATE_PLANNING_PHASE':
      return updateNarrative(state, (n) => {
        const branch = n.branches[action.branchId];
        if (!branch?.planningQueue) return n;
        const phases = [...branch.planningQueue.phases];
        const phase = phases[action.phaseIndex];
        if (!phase) return n;
        phases[action.phaseIndex] = { ...phase, ...action.updates };
        return {
          ...n,
          branches: {
            ...n.branches,
            [action.branchId]: {
              ...branch,
              planningQueue: { ...branch.planningQueue, phases },
            },
          },
        };
      });

    case 'ADVANCE_PLANNING_PHASE':
      return updateNarrative(state, (n) => {
        const branch = n.branches[action.branchId];
        if (!branch?.planningQueue) return n;
        const queue = branch.planningQueue;
        const currentIdx = queue.activePhaseIndex;
        const nextIdx = currentIdx + 1;

        // Mark current phase as completed
        const phases = [...queue.phases];
        if (currentIdx >= 0 && currentIdx < phases.length) {
          phases[currentIdx] = { ...phases[currentIdx], status: 'completed' };
        }

        // Activate next phase or exhaust queue
        if (nextIdx < phases.length) {
          phases[nextIdx] = { ...phases[nextIdx], status: 'active' };
        }

        const isExhausted = nextIdx >= phases.length;

        return {
          ...n,
          branches: {
            ...n.branches,
            [action.branchId]: {
              ...branch,
              // Keep queue with all phases completed so planning_complete end condition can detect it
              planningQueue: { ...queue, phases, activePhaseIndex: isExhausted ? currentIdx : nextIdx },
            },
          },
          // Clear direction/constraints when queue exhausts
          ...(isExhausted && n.storySettings ? {
            storySettings: { ...n.storySettings, storyDirection: '', storyConstraints: '' },
          } : {}),
        };
      });

    default:
      return state;
  }
}

// ── Context ──────────────────────────────────────────────────────────────────
type StoreContextType = {
  state: AppState;
  dispatch: React.Dispatch<Action>;
};

const StoreContext = createContext<StoreContextType | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const prevNarrativeRef = useRef<NarrativeState | null>(null);
  const prevActiveIdRef = useRef<string | null>(null);

  // Wire API logger to store
  useEffect(() => {
    import('@/lib/api-logger').then(({ onApiLog, onApiLogUpdate }) => {
      onApiLog((entry) => dispatch({ type: 'LOG_API_CALL', entry }));
      onApiLogUpdate((id, updates) => dispatch({ type: 'UPDATE_API_LOG', id, updates }));
    });
  }, []);

  // Keep logger aware of which narrative is active
  useEffect(() => {
    import('@/lib/api-logger').then(({ setLoggerNarrativeId }) => {
      setLoggerNarrativeId(state.activeNarrativeId);
    });
  }, [state.activeNarrativeId]);

  // Wire system logger to store
  useEffect(() => {
    import('@/lib/system-logger').then(({ onSystemLog }) => {
      onSystemLog((entry) => dispatch({ type: 'LOG_SYSTEM', entry }));
    });
  }, []);

  // Keep system logger aware of which narrative is active
  useEffect(() => {
    import('@/lib/system-logger').then(({ setSystemLoggerNarrativeId }) => {
      setSystemLoggerNarrativeId(state.activeNarrativeId);
    });
  }, [state.activeNarrativeId]);

  // Hydrate persisted narratives from IndexedDB on mount
  useEffect(() => {
    async function hydrate() {
      // Migrate from localStorage if needed (one-time)
      await migrateFromLocalStorage();

      let persisted: NarrativeState[] = [];
      try {
        persisted = await loadNarratives();
      } catch (err) {
        logError('Failed to load narratives during hydration', err, {
          source: 'other',
          operation: 'hydrate-narratives'
        });
      }
      const persistedById = new Map(persisted.map((n) => [n.id, n]));

      // User entries (from IndexedDB) load immediately
      const userEntries = persisted
        .filter((n) => !SEED_IDS.has(n.id) && !PLAYGROUND_IDS.has(n.id) && !ANALYSIS_IDS.has(n.id))
        .map(narrativeToEntry);

      // Initialize with user entries immediately so UI is responsive
      dispatch({ type: 'HYDRATE_NARRATIVES', entries: userEntries });

      // Helper to import assets from a ZIP in the background (non-blocking, parallel)
      async function importAssetsInBackground(zip: import('jszip'), file: string) {
        const tasks: Promise<void>[] = [];

        // Import embeddings (in parallel)
        const embeddingsFolder = zip.folder('embeddings');
        if (embeddingsFolder) {
          const embFiles = Object.values(embeddingsFolder.files).filter(f => !f.dir && f.name.endsWith('.bin'));
          console.log(`[loadManifest] Importing ${embFiles.length} embeddings from ${file} in background`);
          tasks.push(
            Promise.all(embFiles.map(async (embFile) => {
              const fileName = embFile.name.split('/').pop()!;
              const embId = fileName.replace('.bin', '');
              try {
                const buffer = await embFile.async('arraybuffer');
                const float32Array = new Float32Array(buffer);
                const vector = Array.from(float32Array);
                await assetManager.storeEmbedding(vector, 'text-embedding-3-small', embId);
              } catch (err) {
                console.warn(`Failed to import embedding ${embId}:`, err);
              }
            })).then(() => { console.log(`[loadManifest] Embeddings imported from ${file}`); })
          );
        }

        // Import audio (in parallel)
        const audioFolder = zip.folder('audio');
        if (audioFolder) {
          const audioFiles = Object.values(audioFolder.files).filter(f => !f.dir && f.name.startsWith('audio/'));
          console.log(`[loadManifest] Importing ${audioFiles.length} audio files from ${file} in background`);
          tasks.push(
            Promise.all(audioFiles.map(async (audioFile) => {
              const fileName = audioFile.name.split('/').pop()!;
              const [audioId] = fileName.split('.');
              try {
                const blob = await audioFile.async('blob');
                await assetManager.storeAudio(blob, blob.type, audioId);
              } catch (err) {
                console.warn(`Failed to import audio ${audioId}:`, err);
              }
            })).then(() => { console.log(`[loadManifest] Audio imported from ${file}`); })
          );
        }

        // Import images (in parallel)
        const imagesFolder = zip.folder('images');
        if (imagesFolder) {
          const imageFiles = Object.values(imagesFolder.files).filter(f => !f.dir && f.name.startsWith('images/'));
          console.log(`[loadManifest] Importing ${imageFiles.length} images from ${file} in background`);
          tasks.push(
            Promise.all(imageFiles.map(async (imageFile) => {
              const fileName = imageFile.name.split('/').pop()!;
              const [imgId] = fileName.split('.');
              try {
                const blob = await imageFile.async('blob');
                await assetManager.storeImage(blob, blob.type, imgId);
              } catch (err) {
                console.warn(`Failed to import image ${imgId}:`, err);
              }
            })).then(() => { console.log(`[loadManifest] Images imported from ${file}`); })
          );
        }

        // Run all asset types in parallel
        await Promise.all(tasks);
        console.log(`[loadManifest] Finished importing all assets from ${file}`);
      }

      // Import assets from an extracted directory in the background
      async function importDirAssetsInBackground(basePath: string, entry: string) {
        // Load embeddings manifest
        try {
          const embManifestRes = await fetch(`/${basePath}/${entry}embeddings/manifest.json`);
          if (embManifestRes.ok) {
            const embFiles: string[] = await embManifestRes.json();
            console.log(`[loadManifest] Importing ${embFiles.length} embeddings from ${entry} in background`);
            // Import in batches of 50 to avoid flooding the network
            for (let i = 0; i < embFiles.length; i += 50) {
              const batch = embFiles.slice(i, i + 50);
              await Promise.all(batch.map(async (fileName) => {
                const embId = fileName.replace('.bin', '');
                try {
                  const res = await fetch(`/${basePath}/${entry}embeddings/${fileName}`);
                  if (!res.ok) return;
                  const buffer = await res.arrayBuffer();
                  const float32Array = new Float32Array(buffer);
                  const vector = Array.from(float32Array);
                  await assetManager.storeEmbedding(vector, 'text-embedding-3-small', embId);
                } catch (err) {
                  console.warn(`Failed to import embedding ${embId}:`, err);
                }
              }));
            }
            console.log(`[loadManifest] Embeddings imported from ${entry}`);
          }
        } catch (err) {
          console.warn(`[loadManifest] Failed to import dir embeddings for ${entry}:`, err);
        }
      }

      // Load a single bundled file and dispatch entry immediately when ready
      // Returns the narrative for preset initialization, asset import runs in background
      async function loadBundledFile(
        dir: string,
        file: string,
        idSet: Set<string>
      ): Promise<NarrativeState | null> {
        try {
          // Directory entry — trailing slash means fetch narrative.json from within
          const isDir = file.endsWith('/');

          console.log(`[loadManifest] Loading ${dir}/${file} (${isDir ? 'directory' : 'file'})`);

          const fetchUrl = isDir ? `/${dir}/${file}narrative.json` : `/${dir}/${file}`;
          const r = await fetch(fetchUrl);
          if (!r.ok) {
            console.error(`[loadManifest] Failed to fetch ${fetchUrl}:`, r.status);
            return null;
          }

          const arrayBuffer = await r.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          const isZip = !isDir && bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4B;
          console.log(`[loadManifest] ${file} is ${isDir ? 'DIR' : isZip ? 'ZIP' : 'JSON'} format (size: ${bytes.length} bytes)`);

          let narrative: NarrativeState;

          if (isZip) {
            const JSZip = (await import('jszip')).default;
            const zip = await JSZip.loadAsync(arrayBuffer);

            const narrativeFile = zip.file('narrative.json');
            if (!narrativeFile) {
              console.error(`[loadManifest] Invalid .inktide ZIP in ${dir}/${file}: missing narrative.json`);
              logWarning(`Invalid .inktide ZIP in ${dir}/${file}`, 'missing narrative.json', {
                source: 'other',
                operation: 'load-manifest'
              });
              return null;
            }

            const narrativeText = await narrativeFile.async('text');
            narrative = JSON.parse(narrativeText) as NarrativeState;

            // Check if already in IndexedDB
            const saved = persistedById.get(narrative.id);
            if (saved) {
              console.log(`[loadManifest] Using saved version of ${narrative.title} from IndexedDB`);
              SEED_IDS.add(narrative.id);
              idSet.add(narrative.id);
              dispatch({ type: 'ADD_NARRATIVE_ENTRY', entry: narrativeToEntry(saved) });
              return narrative;
            }

            // Dispatch entry immediately (before asset import)
            console.log(`[loadManifest] Adding bundled narrative: ${narrative.title}`);
            bundledNarratives.set(narrative.id, narrative);
            SEED_IDS.add(narrative.id);
            idSet.add(narrative.id);
            dispatch({ type: 'ADD_NARRATIVE_ENTRY', entry: narrativeToEntry(narrative) });

            // Import assets in background (non-blocking)
            importAssetsInBackground(zip, file).catch(err => {
              console.warn(`[loadManifest] Background asset import failed for ${file}:`, err);
            });
          } else {
            // Plain JSON format (both file and directory entries reach here)
            const text = new TextDecoder().decode(arrayBuffer);
            narrative = JSON.parse(text) as NarrativeState;

            const saved = persistedById.get(narrative.id);
            if (saved) {
              console.log(`[loadManifest] Using saved version of ${narrative.title} from IndexedDB`);
              SEED_IDS.add(narrative.id);
              idSet.add(narrative.id);
              dispatch({ type: 'ADD_NARRATIVE_ENTRY', entry: narrativeToEntry(saved) });
              return narrative;
            }

            console.log(`[loadManifest] Adding bundled narrative: ${narrative.title}`);
            bundledNarratives.set(narrative.id, narrative);
            SEED_IDS.add(narrative.id);
            idSet.add(narrative.id);
            dispatch({ type: 'ADD_NARRATIVE_ENTRY', entry: narrativeToEntry(narrative) });

            // Import directory assets in background
            if (isDir) {
              importDirAssetsInBackground(dir, file).catch(err => {
                console.warn(`[loadManifest] Background dir asset import failed for ${file}:`, err);
              });
            }
          }

          console.log(`[loadManifest] Successfully loaded narrative: ${narrative.title} (${narrative.id})`);
          return narrative;
        } catch (err) {
          console.error(`[loadManifest] Error loading ${dir}/${file}:`, err);
          return null;
        }
      }

      // Load manifest and process files progressively
      async function loadManifestProgressive(dir: string, idSet: Set<string>): Promise<NarrativeState[]> {
        try {
          console.log(`[loadManifest] Fetching manifest from /${dir}/manifest.json`);
          const res = await fetch(`/${dir}/manifest.json`);
          if (!res.ok) {
            console.error(`[loadManifest] Failed to fetch manifest for ${dir}:`, res.status);
            logWarning(`Failed to fetch manifest for ${dir}`, `HTTP ${res.status}`, {
              source: 'other',
              operation: 'load-manifest',
              details: { directory: dir, status: res.status }
            });
            return [];
          }
          const files: string[] = await res.json();
          console.log(`[loadManifest] Found ${files.length} files in ${dir}:`, files);

          // Load all files in parallel, each dispatches its entry as soon as ready
          const results = await Promise.all(
            files.map(file => loadBundledFile(dir, file, idSet))
          );

          console.log(`[loadManifest] Loaded ${results.filter(Boolean).length} narratives from ${dir}`);
          return results.filter((n): n is NarrativeState => n !== null);
        } catch (err) {
          logWarning(`Failed to load manifest for ${dir}`, err, {
            source: 'other',
            operation: 'load-manifest',
            details: { directory: dir }
          });
          return [];
        }
      }

      // Load playgrounds first (complete before works)
      await loadManifestProgressive('playgrounds', PLAYGROUND_IDS);

      // Then load works progressively
      const worksNarratives = await loadManifestProgressive('works', ANALYSIS_IDS);

      // Initialize Markov chain presets from analysed works
      const worksForPresets: { key: string; name: string; narrative: NarrativeState }[] = [];
      for (const narrative of worksNarratives) {
        if (ANALYSIS_IDS.has(narrative.id)) {
          const key = narrative.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');
          worksForPresets.push({ key, name: narrative.title, narrative });
        }
      }
      if (worksForPresets.length > 0) {
        initMatrixPresets(worksForPresets);
        const beatPresets = initBeatProfilePresets(worksForPresets);
        dispatch({ type: 'SET_BEAT_PROFILE_PRESETS', presets: beatPresets });
        const mechanismPresets = initMechanismProfilePresets(worksForPresets);
        dispatch({ type: 'SET_MECHANISM_PROFILE_PRESETS', presets: mechanismPresets });
      }

      // Restore last active narrative
      const savedActiveId = await loadActiveNarrativeId();
      if (savedActiveId) {
        dispatch({ type: 'SET_ACTIVE_NARRATIVE', id: savedActiveId });
      }
    }
    hydrate();
  }, []);

  // Load narrative from IndexedDB when activeNarrativeId changes
  useEffect(() => {
    const id = state.activeNarrativeId;
    if (!id) { prevActiveIdRef.current = null; return; }
    if (id === prevActiveIdRef.current && state.activeNarrative) return;
    prevActiveIdRef.current = id;

    // If activeNarrative is already populated (e.g. from ADD_NARRATIVE), skip async load
    if (state.activeNarrative?.id === id) return;

    let cancelled = false;
    async function load() {
      // Try IndexedDB first, then fall back to bundled narrative
      let narrative = await loadNarrative(id!);
      if (!narrative) {
        const bundled = bundledNarratives.get(id!);
        if (bundled) narrative = bundled;
      }
      const savedBranchId = await loadActiveBranchId();
      if (narrative && !cancelled) {
        dispatch({ type: 'LOADED_NARRATIVE', narrative, savedBranchId });
      }
    }
    load().catch((err) => {
      logError('Failed to load narrative from storage', err, {
        source: 'other',
        operation: 'load-narrative',
        details: { narrativeId: id }
      });
    });
    return () => { cancelled = true; };
  }, [state.activeNarrativeId]);

  // Persist active narrative to IndexedDB whenever it changes
  useEffect(() => {
    const narrative = state.activeNarrative;
    if (!narrative) return;
    // Skip if reference hasn't changed (avoids redundant writes)
    if (narrative === prevNarrativeRef.current) return;
    prevNarrativeRef.current = narrative;

    persistNarrative(narrative).catch((err) => {
      logError('Failed to persist narrative to storage', err, {
        source: 'other',
        operation: 'persist-narrative',
        details: { narrativeId: narrative.id }
      });
    });
  }, [state.activeNarrative]);

  // Persist active narrative ID whenever it changes
  useEffect(() => {
    saveActiveNarrativeId(state.activeNarrativeId).catch((err) => {
      logError('Failed to persist active narrative ID to storage', err, {
        source: 'other',
        operation: 'persist-active-narrative-id',
        details: { narrativeId: state.activeNarrativeId }
      });
    });
  }, [state.activeNarrativeId]);

  // Persist active branch ID whenever it changes (skip null to avoid race with SET_ACTIVE_NARRATIVE)
  useEffect(() => {
    if (state.activeBranchId === null) return;
    saveActiveBranchId(state.activeBranchId).catch((err) => {
      logError('Failed to persist active branch ID to storage', err, {
        source: 'other',
        operation: 'persist-active-branch-id',
        details: { branchId: state.activeBranchId }
      });
    });
  }, [state.activeBranchId]);

  // Hydrate analysis jobs from IndexedDB on mount
  useEffect(() => {
    loadAnalysisJobs().then((jobs) => {
      if (jobs.length > 0) {
        // Mark any previously-running jobs as paused (they were interrupted)
        const restored = jobs.map((j) =>
          j.status === 'running' ? { ...j, status: 'paused' as const, updatedAt: Date.now() } : j,
        );
        dispatch({ type: 'HYDRATE_ANALYSIS_JOBS', jobs: restored });
      }
    });
  }, []);

  // Persist analysis jobs whenever they change + clean up deleted job API logs
  const prevAnalysisJobsRef = useRef(state.analysisJobs);
  useEffect(() => {
    if (state.analysisJobs === prevAnalysisJobsRef.current) return;
    const prevJobs = prevAnalysisJobsRef.current;
    prevAnalysisJobsRef.current = state.analysisJobs;

    // Detect deleted jobs and clean up their API logs
    const currentIds = new Set(state.analysisJobs.map((j) => j.id));
    const deletedJobs = prevJobs.filter((j) => !currentIds.has(j.id));
    for (const job of deletedJobs) {
      deleteAnalysisApiLogs(job.id).catch((err) => {
        logError('Failed to delete analysis API logs', err, {
          source: 'analysis',
          operation: 'delete-analysis-api-logs',
          details: { analysisId: job.id }
        });
      });
    }

    saveAnalysisJobs(state.analysisJobs).catch((err) => {
      logError('Failed to persist analysis jobs to storage', err, {
        source: 'analysis',
        operation: 'persist-analysis-jobs',
        details: { jobCount: state.analysisJobs.length }
      });
    });
  }, [state.analysisJobs]);

  // Load search state from IndexedDB when active narrative changes
  useEffect(() => {
    const narrativeId = state.activeNarrativeId;
    if (!narrativeId) return;

    loadSearchState(narrativeId).then((query) => {
      if (query) {
        dispatch({ type: 'SET_SEARCH_QUERY', query });
      }
    }).catch(() => {
      // Silently fail for search state loading
    });
  }, [state.activeNarrativeId]);

  // Persist search state whenever it changes
  const prevSearchQueryRef = useRef(state.currentSearchQuery);
  useEffect(() => {
    const narrativeId = state.activeNarrativeId;
    if (!narrativeId) return;
    if (state.currentSearchQuery === prevSearchQueryRef.current) return;
    prevSearchQueryRef.current = state.currentSearchQuery;
    saveSearchState(narrativeId, state.currentSearchQuery).catch(() => {
      // Silently fail for search state persistence
    });
  }, [state.currentSearchQuery, state.activeNarrativeId]);

  // API logs are in-memory only for generation/series.
  // Analysis logs are persisted separately by the analysis runner on completion.

  // Cleanup stale pending API logs — mark as timed out after threshold
  useEffect(() => {
    const CLEANUP_INTERVAL_MS = 60 * 1000; // Check every minute

    const cleanup = () => {
      const now = Date.now();
      const staleLogs = state.apiLogs.filter(
        (log) => log.status === 'pending' && (now - log.timestamp) > API_LOG_STALE_THRESHOLD_MS
      );
      for (const log of staleLogs) {
        dispatch({
          type: 'UPDATE_API_LOG',
          id: log.id,
          updates: {
            status: 'error',
            error: 'Request timed out (stale)',
            durationMs: Math.round(now - log.timestamp),
          },
        });
      }
    };

    // Run cleanup immediately on mount and then periodically
    cleanup();
    const intervalId = setInterval(cleanup, CLEANUP_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [state.apiLogs]);

  // Generate prose embeddings for manual prose edits
  const proseEmbeddingQueueRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const narrative = state.activeNarrative;
    const branchId = state.activeBranchId;
    if (!narrative || !branchId) return;

    // Check all scenes for prose that needs embedding
    const scenesToEmbed: Array<{ sceneId: string; prose: string; version: string }> = [];

    for (const [sceneId, scene] of Object.entries(narrative.scenes)) {
      if (!scene.proseVersions || scene.proseVersions.length === 0) continue;

      // Get the latest prose version for this branch
      const latestVersion = scene.proseVersions[scene.proseVersions.length - 1];
      if (!latestVersion || !latestVersion.prose) continue;

      // Skip if already queued or already has embedding
      const queueKey = `${sceneId}-${latestVersion.version}`;
      if (proseEmbeddingQueueRef.current.has(queueKey)) continue;
      if (scene.proseEmbedding) continue; // Scene already has embedding

      scenesToEmbed.push({
        sceneId,
        prose: latestVersion.prose,
        version: latestVersion.version,
      });
    }

    // Generate embeddings for all pending prose
    if (scenesToEmbed.length > 0) {
      for (const { sceneId, prose, version } of scenesToEmbed) {
        const queueKey = `${sceneId}-${version}`;
        proseEmbeddingQueueRef.current.add(queueKey);

        (async () => {
          try {
            const { generateEmbeddings } = await import('@/lib/embeddings');
            const { assetManager } = await import('@/lib/asset-manager');
            const embeddings = await generateEmbeddings([prose], narrative.id);
            const proseEmbedding = await assetManager.storeEmbedding(embeddings[0], 'text-embedding-3-small');

            // Update scene with embedding (non-versioned update)
            dispatch({
              type: 'UPDATE_SCENE',
              sceneId,
              updates: { proseEmbedding },
            });

            // Remove from queue
            proseEmbeddingQueueRef.current.delete(queueKey);
          } catch (err) {
            // Log error but don't fail - embedding is non-critical
            logError('Failed to generate prose embedding', err, {
              source: 'prose-generation',
              operation: 'embed-prose-manual',
              details: { sceneId, narrativeId: narrative.id },
            });
            proseEmbeddingQueueRef.current.delete(queueKey);
          }
        })();
      }
    }
  }, [state.activeNarrative, state.activeBranchId]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          dispatch({ type: 'PREV_SCENE' });
          break;
        case 'ArrowRight':
          e.preventDefault();
          dispatch({ type: 'NEXT_SCENE' });
          break;
        case ' ':
          e.preventDefault();
          dispatch({ type: 'TOGGLE_PLAY' });
          break;
        case 'Escape':
          dispatch({ type: 'SET_INSPECTOR', context: null });
          dispatch({ type: 'SELECT_KNOWLEDGE_ENTITY', entityId: null });
          dispatch({ type: 'SELECT_THREAD_LOG', threadId: null });
          break;
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const contextValue = useMemo(() => ({ state, dispatch }), [state, dispatch]);

  return (
    <StoreContext.Provider value={contextValue}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
