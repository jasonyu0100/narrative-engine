'use client';

import React, { createContext, useContext, useReducer, useEffect, useRef, useMemo, type ReactNode } from 'react';
import type { AppState, ControlMode, InspectorContext, NarrativeState, NarrativeEntry, WizardStep, WizardData, Scene, Arc, Branch, Character, Location, Thread, RelationshipEdge, GraphViewMode, AutoConfig, AutoRunState, AutoRunLog, WorldBuildCommit } from '@/types/narrative';
import { resolveSceneSequence, nextId, computeForceSnapshots, computeSwingMagnitudes, computeDeliveryCurve, classifyNarrativeShape, classifyArchetype, gradeForces, computeRawForcetotals, FORCE_REFERENCE_MEANS } from '@/lib/narrative-utils';
import { initMatrixPresets } from '@/lib/markov';
import { resolveEntry, isScene } from '@/types/narrative';
import { loadNarratives, saveNarrative as persistNarrative, deleteNarrative as deletePersisted, loadNarrative, saveActiveNarrativeId, loadActiveNarrativeId, saveActiveBranchId, loadActiveBranchId, migrateFromLocalStorage, loadAnalysisJobs, saveAnalysisJobs } from '@/lib/persistence';
import { analysisRunner as analysisRunnerRef } from '@/lib/analysis-runner';

// Bundled narratives loaded at runtime from /public manifests
const bundledNarratives = new Map<string, NarrativeState>();

function narrativeToEntry(n: NarrativeState): NarrativeEntry {
  const threadValues = Object.values(n.threads);

  // Compute shape, archetype, and score from scenes
  const branchId = getRootBranchId(n);
  const keys = branchId ? resolveSceneSequence(n.branches, branchId) : [...Object.keys(n.scenes), ...Object.keys(n.worldBuilds)];
  const allScenes = keys.map((k) => resolveEntry(n, k)).filter((e): e is Scene => !!e && isScene(e));

  let shapeKey: string | undefined;
  let shapeName: string | undefined;
  let shapeCurve: [number, number][] | undefined;
  let archetypeKey: string | undefined;
  let archetypeName: string | undefined;
  let overallScore: number | undefined;

  if (allScenes.length >= 3) {
    const raw = computeRawForcetotals(allScenes);
    const rawForces = raw.payoff.map((_, i) => ({
      payoff: raw.payoff[i],
      change: raw.change[i],
      knowledge: raw.knowledge[i],
    }));
    const swings = computeSwingMagnitudes(rawForces, FORCE_REFERENCE_MEANS);
    const forceMap = computeForceSnapshots(allScenes);
    const ordered = allScenes.map((s) => forceMap[s.id] ?? { payoff: 0, change: 0, knowledge: 0 });
    const deliveryPoints = computeDeliveryCurve(ordered);
    const grades = gradeForces(raw.payoff, raw.change, raw.knowledge, swings);

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
  };
}

function getRootBranchId(n: NarrativeState): string | null {
  const root = Object.values(n.branches).find((b) => b.parentBranchId === null);
  return root?.id ?? null;
}

function getResolvedKeys(n: NarrativeState, branchId: string | null): string[] {
  if (!branchId) return [...Object.keys(n.scenes), ...Object.keys(n.worldBuilds)];
  return resolveSceneSequence(n.branches, branchId);
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
      e.id === updated.id ? narrativeToEntry(updated) : e,
    ),
  };
}

/**
 * Apply scene mutations (relationship + knowledge) to the narrative state.
 * - relationshipMutations: update valence of existing edges or create new ones
 * - continuityMutations: add/remove knowledge nodes on characters
 * - threadMutations: update thread statuses
 */
function applySceneMutations(n: NarrativeState, scenes: Scene[]): NarrativeState {
  let relationships = [...n.relationships];
  const characters = { ...n.characters };
  const threads = { ...n.threads };
  const worldKnowledge = { nodes: { ...n.worldKnowledge?.nodes }, edges: [...(n.worldKnowledge?.edges ?? [])] };

  for (const scene of scenes) {
    // ── Apply relationship mutations ──────────────────────────────────
    for (const rm of scene.relationshipMutations) {
      const idx = relationships.findIndex((r) => r.from === rm.from && r.to === rm.to);
      if (idx >= 0) {
        // Update existing edge
        const existing = relationships[idx];
        relationships = [
          ...relationships.slice(0, idx),
          { ...existing, type: rm.type, valence: Math.max(-1, Math.min(1, existing.valence + rm.valenceDelta)) },
          ...relationships.slice(idx + 1),
        ];
      } else {
        // Create new relationship edge
        relationships.push({
          from: rm.from,
          to: rm.to,
          type: rm.type,
          valence: Math.max(-1, Math.min(1, rm.valenceDelta)),
        });
      }
    }

    // ── Apply knowledge mutations ─────────────────────────────────────
    for (const km of scene.continuityMutations) {
      const char = characters[km.characterId];
      if (!char) continue;

      if (km.action === 'added') {
        // Add knowledge node if it doesn't already exist
        const exists = (char.continuity?.nodes ?? []).some((kn) => kn.id === km.nodeId);
        if (!exists) {
          characters[km.characterId] = {
            ...char,
            continuity: {
              ...char.continuity,
              nodes: [...(char.continuity?.nodes ?? []), { id: km.nodeId, type: km.nodeType ?? 'learned', content: km.content }],
            },
          };
        }
      } else if (km.action === 'removed') {
        characters[km.characterId] = {
          ...char,
          continuity: {
            ...char.continuity,
            nodes: (char.continuity?.nodes ?? []).filter((kn) => kn.id !== km.nodeId),
          },
        };
      }
    }

    // ── Apply thread mutations ────────────────────────────────────────
    for (const tm of scene.threadMutations) {
      const thread = threads[tm.threadId];
      if (thread) {
        threads[tm.threadId] = { ...thread, status: tm.to };
      }
    }

    // ── Apply world knowledge mutations ──────────────────────────────
    const wkm = scene.worldKnowledgeMutations;
    if (wkm) {
      for (const node of wkm.addedNodes ?? []) {
        if (!worldKnowledge.nodes[node.id]) {
          worldKnowledge.nodes[node.id] = { id: node.id, concept: node.concept, type: node.type };
        }
      }
      for (const edge of wkm.addedEdges ?? []) {
        if (!worldKnowledge.edges.some((e: { from: string; to: string; relation: string }) => e.from === edge.from && e.to === edge.to && e.relation === edge.relation)) {
          worldKnowledge.edges.push({ from: edge.from, to: edge.to, relation: edge.relation });
        }
      }
    }
  }

  return { ...n, relationships, characters, threads, worldKnowledge };
}

export const SEED_NARRATIVE_IDS = SEED_IDS;
export const PLAYGROUND_NARRATIVE_IDS = PLAYGROUND_IDS;
export const ANALYSIS_NARRATIVE_IDS = ANALYSIS_IDS;


const initialState: AppState = {
  narratives: [],
  activeNarrativeId: null,
  activeNarrative: null,
  controlMode: 'auto',
  isPlaying: false,
  currentSceneIndex: 0,
  activeBranchId: null,
  resolvedSceneKeys: [],
  inspectorContext: null,
  wizardOpen: false,
  wizardStep: 'form',
  wizardData: { title: '', premise: '', characters: [], locations: [], rules: [] },
  selectedKnowledgeEntity: null,
  autoTimer: 30,
  graphViewMode: 'spatial',
  autoConfig: {
    objective: 'explore_and_resolve',
    endConditions: [{ type: 'scene_count', target: 50 }],
    minArcLength: 2,
    maxArcLength: 5,
    worldBuildInterval: 3,
    worldBuildSize: 'medium',
    maxActiveThreads: 6,
    threadStagnationThreshold: 5,
    northStarPrompt: '',
    toneGuidance: '',
    narrativeConstraints: '',
    characterRotationEnabled: true,
    minScenesBetweenCharacterFocus: 3,
    enforceWorldBuildUsage: true,
  },
  autoRunState: null,
  apiLogs: [],
  analysisJobs: [],
};

// ── Actions ──────────────────────────────────────────────────────────────────
export type Action =
  | { type: 'HYDRATE_NARRATIVES'; entries: NarrativeEntry[] }
  | { type: 'SET_ACTIVE_NARRATIVE'; id: string }
  | { type: 'LOADED_NARRATIVE'; narrative: NarrativeState; savedBranchId?: string | null }
  | { type: 'CLEAR_ACTIVE_NARRATIVE' }
  | { type: 'SET_CONTROL_MODE'; mode: ControlMode }
  | { type: 'TOGGLE_PLAY' }
  | { type: 'STOP' }
  | { type: 'NEXT_SCENE' }
  | { type: 'PREV_SCENE' }
  | { type: 'SET_SCENE_INDEX'; index: number }
  | { type: 'SET_INSPECTOR'; context: InspectorContext | null }
  | { type: 'OPEN_WIZARD'; prefill?: string }
  | { type: 'CLOSE_WIZARD' }
  | { type: 'SET_WIZARD_STEP'; step: WizardStep }
  | { type: 'UPDATE_WIZARD_DATA'; data: Partial<WizardData> }
  | { type: 'ADD_NARRATIVE'; narrative: NarrativeState }
  | { type: 'DELETE_NARRATIVE'; id: string }
  | { type: 'SELECT_KNOWLEDGE_ENTITY'; entityId: string | null }
  | { type: 'SET_AUTO_TIMER'; seconds: number }
  | { type: 'SET_GRAPH_VIEW_MODE'; mode: GraphViewMode }
  | { type: 'SWITCH_BRANCH'; branchId: string }
  // CRUD
  | { type: 'UPDATE_NARRATIVE_META'; title?: string; description?: string; worldSummary?: string }
  | { type: 'UPDATE_SCENE'; sceneId: string; updates: Partial<Pick<Scene, 'summary' | 'prose' | 'proseScore' | 'plan' | 'events' | 'locationId' | 'participantIds' | 'povId' | 'threadMutations' | 'continuityMutations' | 'relationshipMutations' | 'worldKnowledgeMutations' | 'characterMovements' | 'arcId' | 'locked'>> }
  | { type: 'CREATE_SCENE'; scene: Scene; branchId: string }
  | { type: 'DELETE_SCENE'; sceneId: string; branchId: string }
  | { type: 'UPDATE_ARC'; arcId: string; updates: Partial<Pick<Arc, 'name' | 'develops' | 'locationIds' | 'activeCharacterIds'>> }
  | { type: 'CREATE_ARC'; arc: Arc }
  | { type: 'DELETE_ARC'; arcId: string }
  | { type: 'UPDATE_CHARACTER'; characterId: string; updates: Partial<Pick<Character, 'name' | 'role'>> }
  | { type: 'CREATE_CHARACTER'; character: Character }
  | { type: 'DELETE_CHARACTER'; characterId: string }
  | { type: 'UPDATE_LOCATION'; locationId: string; updates: Partial<Pick<Location, 'name' | 'parentId'>> }
  | { type: 'CREATE_LOCATION'; location: Location }
  | { type: 'DELETE_LOCATION'; locationId: string }
  | { type: 'UPDATE_THREAD'; threadId: string; updates: Partial<Pick<Thread, 'description' | 'status'>> }
  | { type: 'CREATE_THREAD'; thread: Thread }
  | { type: 'DELETE_THREAD'; threadId: string }
  | { type: 'CREATE_BRANCH'; branch: Branch }
  | { type: 'DELETE_BRANCH'; branchId: string }
  | { type: 'RENAME_BRANCH'; branchId: string; name: string }
  | { type: 'REMOVE_BRANCH_ENTRY'; entryId: string; branchId: string }
  | { type: 'ADD_RELATIONSHIP'; relationship: RelationshipEdge }
  | { type: 'REMOVE_RELATIONSHIP'; from: string; to: string }
  | { type: 'BULK_ADD_SCENES'; scenes: Scene[]; arc: Arc; branchId: string }
  | { type: 'EXPAND_WORLD'; wxId: string; characters: Character[]; locations: Location[]; threads: Thread[]; relationships: RelationshipEdge[]; branchId: string; worldKnowledgeMutations?: import('@/types/narrative').WorldKnowledgeMutation }
  | { type: 'REPLACE_NARRATIVE'; narrative: NarrativeState }
  // Auto mode
  | { type: 'SET_AUTO_CONFIG'; config: AutoConfig }
  | { type: 'START_AUTO_RUN' }
  | { type: 'PAUSE_AUTO_RUN' }
  | { type: 'RESUME_AUTO_RUN' }
  | { type: 'STOP_AUTO_RUN' }
  | { type: 'LOG_AUTO_CYCLE'; entry: AutoRunLog }
  // API Logs
  | { type: 'LOG_API_CALL'; entry: import('@/types/narrative').ApiLogEntry }
  | { type: 'UPDATE_API_LOG'; id: string; updates: Partial<import('@/types/narrative').ApiLogEntry> }
  | { type: 'CLEAR_API_LOGS' }
  | { type: 'SET_COVER_IMAGE'; narrativeId: string; imageUrl: string }
  | { type: 'SET_SCENE_IMAGE'; sceneId: string; imageUrl: string }
  | { type: 'SET_CHARACTER_IMAGE'; characterId: string; imageUrl: string }
  | { type: 'SET_LOCATION_IMAGE'; locationId: string; imageUrl: string }
  | { type: 'SET_IMAGE_STYLE'; style: string }
  | { type: 'SET_RULES'; rules: string[] }
  | { type: 'SET_STORY_SETTINGS'; settings: import('@/types/narrative').StorySettings }
  // Analysis
  | { type: 'ADD_ANALYSIS_JOB'; job: import('@/types/narrative').AnalysisJob }
  | { type: 'UPDATE_ANALYSIS_JOB'; id: string; updates: Partial<import('@/types/narrative').AnalysisJob> }
  | { type: 'DELETE_ANALYSIS_JOB'; id: string }
  | { type: 'HYDRATE_ANALYSIS_JOBS'; jobs: import('@/types/narrative').AnalysisJob[] };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'HYDRATE_NARRATIVES': {
      return { ...state, narratives: action.entries };
    }
    case 'SET_ACTIVE_NARRATIVE': {
      // Just set the ID — the async loading effect will populate the narrative
      if (state.activeNarrativeId === action.id && state.activeNarrative) return state;
      return {
        ...state,
        activeNarrativeId: action.id,
        activeNarrative: null, // cleared until async load completes
        activeBranchId: null,
        resolvedSceneKeys: [],
        currentSceneIndex: 0,
        inspectorContext: null,
        selectedKnowledgeEntity: null,
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
      return {
        ...state,
        activeNarrative: action.narrative,
        activeBranchId: branchId,
        resolvedSceneKeys: resolved,
        currentSceneIndex: resolved.length - 1,
      };
    }
    case 'CLEAR_ACTIVE_NARRATIVE':
      return { ...state, activeNarrativeId: null, activeNarrative: null, inspectorContext: null, selectedKnowledgeEntity: null };
    case 'SET_CONTROL_MODE':
      return { ...state, controlMode: action.mode, isPlaying: false };
    case 'TOGGLE_PLAY':
      return { ...state, isPlaying: !state.isPlaying };
    case 'STOP':
      return { ...state, isPlaying: false };
    case 'NEXT_SCENE': {
      const max = state.resolvedSceneKeys.length - 1;
      const nextIdx = Math.min(state.currentSceneIndex + 1, Math.max(0, max));
      const nextSceneId = state.resolvedSceneKeys[nextIdx] ?? null;
      return {
        ...state,
        currentSceneIndex: nextIdx,
        inspectorContext: nextSceneId ? { type: 'scene' as const, sceneId: nextSceneId } : state.inspectorContext,
      };
    }
    case 'PREV_SCENE': {
      const prevIdx = Math.max(state.currentSceneIndex - 1, 0);
      const prevSceneId = state.resolvedSceneKeys[prevIdx] ?? null;
      return {
        ...state,
        currentSceneIndex: prevIdx,
        inspectorContext: prevSceneId ? { type: 'scene' as const, sceneId: prevSceneId } : state.inspectorContext,
      };
    }
    case 'SET_SCENE_INDEX':
      return { ...state, currentSceneIndex: action.index };
    case 'SET_INSPECTOR':
      return { ...state, inspectorContext: action.context };
    case 'OPEN_WIZARD':
      return { ...state, wizardOpen: true, wizardStep: 'form', wizardData: { title: '', premise: action.prefill ?? '', characters: [], locations: [], rules: [] } };
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
      const hasExistingWx = Object.keys(n.worldBuilds).length > 0;
      const wxId = nextId('WX', Object.keys(n.worldBuilds), 3);
      if (rootBranch && !hasExistingWx && (allChars.length > 0 || allLocs.length > 0 || allThreads.length > 0)) {
        const parts: string[] = [];
        if (allChars.length > 0) parts.push(`${allChars.length} character${allChars.length > 1 ? 's' : ''} (${allChars.map((c) => c.name).join(', ')})`);
        if (allLocs.length > 0) parts.push(`${allLocs.length} location${allLocs.length > 1 ? 's' : ''} (${allLocs.map((l) => l.name).join(', ')})`);
        if (allThreads.length > 0) parts.push(`${allThreads.length} thread${allThreads.length > 1 ? 's' : ''}`);
        if (n.relationships.length > 0) parts.push(`${n.relationships.length} relationship${n.relationships.length > 1 ? 's' : ''}`);

        const wxCommit: WorldBuildCommit = {
          kind: 'world_build',
          id: wxId,
          summary: `World created: ${parts.join(', ')}`,
          expansionManifest: {
            characterIds: allChars.map((c) => c.id),
            locationIds: allLocs.map((l) => l.id),
            threadIds: allThreads.map((t) => t.id),
            relationshipCount: n.relationships.length,
          },
        };

        // Prepend the world-build commit before existing entries in the branch
        n.worldBuilds[wxId] = wxCommit;
        n.branches[rootBranch.id] = {
          ...rootBranch,
          entryIds: [wxId, ...rootBranch.entryIds],
        };
      }

      // Apply relationship, knowledge, and thread mutations from initial scenes
      const allScenes = Object.values(n.scenes);
      const mutated = applySceneMutations(n, allScenes);

      const entry = narrativeToEntry(mutated);
      const newBranchId = getRootBranchId(mutated);
      const newResolved = getResolvedKeys(mutated, newBranchId);
      // Persistence handled by effects watching activeNarrative
      return {
        ...state,
        narratives: [...state.narratives, entry],
        activeNarrativeId: mutated.id,
        activeNarrative: mutated,
        activeBranchId: newBranchId,
        resolvedSceneKeys: newResolved,
        currentSceneIndex: Math.max(0, newResolved.length - 1),
        wizardOpen: false,
      };
    }
    case 'DELETE_NARRATIVE': {
      const isSeed = SEED_IDS.has(action.id);
      const isActive = state.activeNarrativeId === action.id;

      // Fire-and-forget async delete
      deletePersisted(action.id).catch((err) => {
        console.error('[store] Failed to delete narrative:', err);
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
      return { ...state, selectedKnowledgeEntity: action.entityId };
    case 'SET_AUTO_TIMER':
      return { ...state, autoTimer: action.seconds };
    case 'SET_GRAPH_VIEW_MODE':
      return { ...state, graphViewMode: action.mode };
    case 'SWITCH_BRANCH': {
      if (!state.activeNarrative) return state;
      const resolved = getResolvedKeys(state.activeNarrative, action.branchId);
      return {
        ...state,
        activeBranchId: action.branchId,
        resolvedSceneKeys: resolved,
        currentSceneIndex: resolved.length - 1,
        inspectorContext: resolved.length > 0
          ? { type: 'scene' as const, sceneId: resolved[resolved.length - 1] }
          : null,
        selectedKnowledgeEntity: null,
      };
    }

    // ── CRUD: Narrative meta ──────────────────────────────────────────────
    case 'UPDATE_NARRATIVE_META':
      return updateNarrative(state, (n) => ({
        ...n,
        title: action.title ?? n.title,
        description: action.description ?? n.description,
        worldSummary: action.worldSummary ?? n.worldSummary,
      }));

    // ── CRUD: Scenes ──────────────────────────────────────────────────────
    case 'UPDATE_SCENE':
      return updateNarrative(state, (n) => {
        const scene = n.scenes[action.sceneId];
        if (!scene) return n;
        return { ...n, scenes: { ...n.scenes, [action.sceneId]: { ...scene, ...action.updates } } };
      });

    case 'CREATE_SCENE': {
      const newState = updateNarrative(state, (n) => {
        const branch = n.branches[action.branchId];
        if (!branch) return n;
        const arc = n.arcs[action.scene.arcId];
        const updatedArcs = arc
          ? { ...n.arcs, [arc.id]: { ...arc, sceneIds: [...arc.sceneIds, action.scene.id] } }
          : n.arcs;
        return {
          ...n,
          scenes: { ...n.scenes, [action.scene.id]: action.scene },
          arcs: updatedArcs,
          branches: {
            ...n.branches,
            [action.branchId]: { ...branch, entryIds: [...branch.entryIds, action.scene.id] },
          },
        };
      });
      if (newState.activeNarrative && newState.activeBranchId) {
        const resolved = getResolvedKeys(newState.activeNarrative, newState.activeBranchId);
        return { ...newState, resolvedSceneKeys: resolved, currentSceneIndex: resolved.length - 1 };
      }
      return newState;
    }

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
        return { ...newState, resolvedSceneKeys: resolved, currentSceneIndex: Math.min(newState.currentSceneIndex, resolved.length - 1) };
      }
      return newState;
    }

    // ── CRUD: Arcs ────────────────────────────────────────────────────────
    case 'UPDATE_ARC':
      return updateNarrative(state, (n) => {
        const arc = n.arcs[action.arcId];
        if (!arc) return n;
        return { ...n, arcs: { ...n.arcs, [action.arcId]: { ...arc, ...action.updates } } };
      });

    case 'CREATE_ARC':
      return updateNarrative(state, (n) => ({
        ...n, arcs: { ...n.arcs, [action.arc.id]: action.arc },
      }));

    case 'DELETE_ARC':
      return updateNarrative(state, (n) => {
        const { [action.arcId]: _, ...restArcs } = n.arcs;
        return { ...n, arcs: restArcs };
      });

    // ── CRUD: Characters ──────────────────────────────────────────────────
    case 'UPDATE_CHARACTER':
      return updateNarrative(state, (n) => {
        const char = n.characters[action.characterId];
        if (!char) return n;
        return { ...n, characters: { ...n.characters, [action.characterId]: { ...char, ...action.updates } } };
      });

    case 'CREATE_CHARACTER':
      return updateNarrative(state, (n) => ({
        ...n, characters: { ...n.characters, [action.character.id]: action.character },
      }));

    case 'DELETE_CHARACTER':
      return updateNarrative(state, (n) => {
        const { [action.characterId]: _, ...rest } = n.characters;
        return { ...n, characters: rest };
      });

    // ── CRUD: Locations ───────────────────────────────────────────────────
    case 'UPDATE_LOCATION':
      return updateNarrative(state, (n) => {
        const loc = n.locations[action.locationId];
        if (!loc) return n;
        return { ...n, locations: { ...n.locations, [action.locationId]: { ...loc, ...action.updates } } };
      });

    case 'CREATE_LOCATION':
      return updateNarrative(state, (n) => ({
        ...n, locations: { ...n.locations, [action.location.id]: action.location },
      }));

    case 'DELETE_LOCATION':
      return updateNarrative(state, (n) => {
        const { [action.locationId]: _, ...rest } = n.locations;
        return { ...n, locations: rest };
      });

    // ── CRUD: Threads ─────────────────────────────────────────────────────
    case 'UPDATE_THREAD':
      return updateNarrative(state, (n) => {
        const thread = n.threads[action.threadId];
        if (!thread) return n;
        return { ...n, threads: { ...n.threads, [action.threadId]: { ...thread, ...action.updates } } };
      });

    case 'CREATE_THREAD':
      return updateNarrative(state, (n) => ({
        ...n, threads: { ...n.threads, [action.thread.id]: action.thread },
      }));

    case 'DELETE_THREAD':
      return updateNarrative(state, (n) => {
        const { [action.threadId]: _, ...rest } = n.threads;
        return { ...n, threads: rest };
      });

    // ── CRUD: Branches ────────────────────────────────────────────────────
    case 'CREATE_BRANCH': {
      const newState = updateNarrative(state, (n) => ({
        ...n, branches: { ...n.branches, [action.branch.id]: action.branch },
      }));
      if (newState.activeNarrative) {
        const resolved = getResolvedKeys(newState.activeNarrative, action.branch.id);
        return { ...newState, activeBranchId: action.branch.id, resolvedSceneKeys: resolved, currentSceneIndex: resolved.length - 1 };
      }
      return newState;
    }

    case 'DELETE_BRANCH': {
      if (action.branchId === state.activeBranchId) return state;
      // Build full cascade set before mutating so we can guard against it
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
      // Block if the cascade would wipe out the active branch
      if (state.activeBranchId && toDelete.has(state.activeBranchId)) return state;
      return updateNarrative(state, (n) => {
        const remaining = Object.fromEntries(
          Object.entries(n.branches).filter(([id]) => !toDelete.has(id)),
        );

        // Collect entry IDs owned by deleted branches
        const deletedEntries = new Set<string>();
        toDelete.forEach((bid) => {
          n.branches[bid]?.entryIds.forEach((eid) => deletedEntries.add(eid));
        });

        // Keep entries that are still referenced by a surviving branch
        const survivingEntries = new Set<string>();
        Object.values(remaining).forEach((b) => {
          b.entryIds.forEach((eid) => survivingEntries.add(eid));
        });

        const entriesToRemove = new Set(
          [...deletedEntries].filter((eid) => !survivingEntries.has(eid)),
        );

        // Surviving scenes and world builds
        const scenes = Object.fromEntries(
          Object.entries(n.scenes).filter(([id]) => !entriesToRemove.has(id)),
        );
        const worldBuilds = Object.fromEntries(
          Object.entries(n.worldBuilds).filter(([id]) => !entriesToRemove.has(id)),
        );

        // Collect candidate characters/locations/threads from deleted world builds
        const candidateCharIds = new Set<string>();
        const candidateLocIds = new Set<string>();
        const candidateThreadIds = new Set<string>();
        entriesToRemove.forEach((eid) => {
          const wb = n.worldBuilds[eid];
          if (wb) {
            wb.expansionManifest.characterIds.forEach((id) => candidateCharIds.add(id));
            wb.expansionManifest.locationIds.forEach((id) => candidateLocIds.add(id));
            wb.expansionManifest.threadIds.forEach((id) => candidateThreadIds.add(id));
          }
        });

        // Scan surviving scenes/arcs to find which candidates are still referenced
        const usedCharIds = new Set<string>();
        const usedLocIds = new Set<string>();
        Object.values(scenes).forEach((s) => {
          s.participantIds.forEach((id) => usedCharIds.add(id));
          usedCharIds.add(s.povId);
          usedLocIds.add(s.locationId);
          Object.keys(s.characterMovements ?? {}).forEach((id) => usedCharIds.add(id));
          Object.values(s.characterMovements ?? {}).forEach((mv) => usedLocIds.add(typeof mv === 'string' ? mv : mv.locationId));
        });
        Object.values(n.arcs).forEach((arc) => {
          arc.activeCharacterIds.forEach((id) => usedCharIds.add(id));
          arc.locationIds.forEach((id) => usedLocIds.add(id));
          Object.keys(arc.initialCharacterLocations).forEach((id) => usedCharIds.add(id));
          Object.values(arc.initialCharacterLocations).forEach((id) => usedLocIds.add(id));
        });
        // Threads anchored to surviving characters/locations
        const usedThreadIds = new Set<string>();
        Object.values(n.threads).forEach((t) => {
          t.anchors.forEach((a) => {
            if (a.type === 'character' && !candidateCharIds.has(a.id)) usedThreadIds.add(t.id);
            if (a.type === 'location' && !candidateLocIds.has(a.id)) usedThreadIds.add(t.id);
          });
        });

        const charsToDelete = new Set([...candidateCharIds].filter((id) => !usedCharIds.has(id)));
        const locsToDelete = new Set([...candidateLocIds].filter((id) => !usedLocIds.has(id)));
        const threadsToDelete = new Set([...candidateThreadIds].filter((id) => !usedThreadIds.has(id)));

        const characters = Object.fromEntries(
          Object.entries(n.characters)
            .filter(([id]) => !charsToDelete.has(id))
            .map(([id, c]) => [id, { ...c, threadIds: c.threadIds.filter((tid) => !threadsToDelete.has(tid)) }]),
        );
        const locations = Object.fromEntries(
          Object.entries(n.locations).filter(([id]) => !locsToDelete.has(id)),
        );
        const threads = Object.fromEntries(
          Object.entries(n.threads).filter(([id]) => !threadsToDelete.has(id)),
        );
        const relationships = n.relationships.filter(
          (r) => !charsToDelete.has(r.from) && !charsToDelete.has(r.to),
        );

        // Clean up arcs: remove deleted scene IDs, drop empty arcs, strip deleted char/loc refs
        const arcs = Object.fromEntries(
          Object.entries(n.arcs).flatMap(([id, arc]) => {
            const sceneIds = arc.sceneIds.filter((sid) => !entriesToRemove.has(sid));
            if (sceneIds.length === 0) return [];
            return [[id, {
              ...arc,
              sceneIds,
              activeCharacterIds: arc.activeCharacterIds.filter((cid) => !charsToDelete.has(cid)),
              locationIds: arc.locationIds.filter((lid) => !locsToDelete.has(lid)),
              initialCharacterLocations: Object.fromEntries(
                Object.entries(arc.initialCharacterLocations)
                  .filter(([cid, lid]) => !charsToDelete.has(cid) && !locsToDelete.has(lid)),
              ),
            }]];
          }),
        );

        return { ...n, branches: remaining, scenes, worldBuilds, arcs, characters, locations, threads, relationships };
      });
    }

    case 'RENAME_BRANCH':
      return updateNarrative(state, (n) => {
        const branch = n.branches[action.branchId];
        if (!branch) return n;
        return { ...n, branches: { ...n.branches, [action.branchId]: { ...branch, name: action.name } } };
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
        return { ...newState, resolvedSceneKeys: resolved, currentSceneIndex: Math.min(newState.currentSceneIndex, resolved.length - 1) };
      }
      return newState;
    }

    // ── CRUD: Relationships ───────────────────────────────────────────────
    case 'ADD_RELATIONSHIP':
      return updateNarrative(state, (n) => ({
        ...n, relationships: [...n.relationships, action.relationship],
      }));

    case 'REMOVE_RELATIONSHIP':
      return updateNarrative(state, (n) => ({
        ...n, relationships: n.relationships.filter((r) => !(r.from === action.from && r.to === action.to)),
      }));

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
        const updatedBranches = branch
          ? { ...n.branches, [action.branchId]: { ...branch, entryIds: [...branch.entryIds, ...dedupedEntries] } }
          : n.branches;
        // Apply relationship, knowledge, and thread mutations from the new scenes
        const withMutations = applySceneMutations(
          { ...n, scenes: newScenes, arcs: updatedArcs, branches: updatedBranches },
          action.scenes,
        );
        return withMutations;
      });
      if (newState.activeNarrative && newState.activeBranchId) {
        const resolved = getResolvedKeys(newState.activeNarrative, newState.activeBranchId);
        return { ...newState, resolvedSceneKeys: resolved, currentSceneIndex: resolved.length - 1 };
      }
      return newState;
    }

    // ── Expand World: merge new elements + create world-build commit ─────
    case 'EXPAND_WORLD': {
      const wxId = action.wxId;

      // Build summary from expansion contents
      const charNames = action.characters.map((c) => c.name);
      const locNames = action.locations.map((l) => l.name);
      const threadDescs = action.threads.map((t) => t.description);
      const parts: string[] = [];
      if (charNames.length > 0) parts.push(`${charNames.length} character${charNames.length > 1 ? 's' : ''} (${charNames.join(', ')})`);
      if (locNames.length > 0) parts.push(`${locNames.length} location${locNames.length > 1 ? 's' : ''} (${locNames.join(', ')})`);
      if (threadDescs.length > 0) parts.push(`${threadDescs.length} thread${threadDescs.length > 1 ? 's' : ''}`);
      if (action.relationships.length > 0) parts.push(`${action.relationships.length} relationship${action.relationships.length > 1 ? 's' : ''}`);
      const wxSummary = parts.length > 0 ? `World expanded: added ${parts.join(', ')}` : 'World expansion (no new elements)';

      const wxCommit: WorldBuildCommit = {
        kind: 'world_build',
        id: wxId,
        summary: wxSummary,
        expansionManifest: {
          characterIds: action.characters.map((c) => c.id),
          locationIds: action.locations.map((l) => l.id),
          threadIds: action.threads.map((t) => t.id),
          relationshipCount: action.relationships.length,
        },
        worldKnowledgeMutations: action.worldKnowledgeMutations,
      };

      const newState = updateNarrative(state, (n) => {
        // Idempotent: skip if this world build was already applied
        if (n.worldBuilds[wxId]) return n;

        // Merge world elements
        const newCharacters = { ...n.characters };
        for (const c of action.characters) newCharacters[c.id] = c;
        const newLocations = { ...n.locations };
        for (const l of action.locations) newLocations[l.id] = l;
        const newThreads = { ...n.threads };
        for (const t of action.threads) newThreads[t.id] = { ...t, openedAt: wxId };
        const newRelationships = [...n.relationships, ...action.relationships];

        // Apply world knowledge: explicit mutations from action + auto-generated from new entities
        const wk = { nodes: { ...n.worldKnowledge?.nodes }, edges: [...(n.worldKnowledge?.edges ?? [])] };
        const existingWkIds = Object.keys(wk.nodes);
        let wkCounter = existingWkIds.length;
        // Explicit mutations (if provided)
        const wkm = action.worldKnowledgeMutations;
        if (wkm) {
          for (const node of wkm.addedNodes ?? []) {
            if (!wk.nodes[node.id]) wk.nodes[node.id] = { id: node.id, concept: node.concept, type: node.type };
          }
          for (const edge of wkm.addedEdges ?? []) {
            if (!wk.edges.some((e: { from: string; to: string; relation: string }) => e.from === edge.from && e.to === edge.to && e.relation === edge.relation)) {
              wk.edges.push({ from: edge.from, to: edge.to, relation: edge.relation });
            }
          }
        }
        // Auto-generate for new threads and locations (skip if already covered by explicit mutations)
        for (const t of action.threads) {
          if (Object.values(wk.nodes).some((n) => n.concept === t.description)) continue;
          const wkId = `WK-${String(++wkCounter).padStart(2, '0')}`;
          wk.nodes[wkId] = { id: wkId, concept: t.description, type: 'concept' as const };
        }
        for (const l of action.locations) {
          if (Object.values(wk.nodes).some((n) => n.concept === l.name)) continue;
          const wkId = `WK-${String(++wkCounter).padStart(2, '0')}`;
          wk.nodes[wkId] = { id: wkId, concept: l.name, type: 'concept' as const };
        }

        const branch = n.branches[action.branchId];
        const updatedBranches = branch
          ? { ...n.branches, [action.branchId]: { ...branch, entryIds: [...branch.entryIds, wxId] } }
          : n.branches;

        return {
          ...n,
          characters: newCharacters,
          locations: newLocations,
          threads: newThreads,
          relationships: newRelationships,
          worldKnowledge: wk,
          worldBuilds: { ...n.worldBuilds, [wxId]: wxCommit },
          branches: updatedBranches,
        };
      });

      if (newState.activeNarrative && newState.activeBranchId) {
        const resolved = getResolvedKeys(newState.activeNarrative, newState.activeBranchId);
        return { ...newState, resolvedSceneKeys: resolved, currentSceneIndex: resolved.length - 1 };
      }
      return newState;
    }

    // ── Replace entire narrative (import) ─────────────────────────────────
    case 'REPLACE_NARRATIVE': {
      const entry = narrativeToEntry(action.narrative);
      const branchId = getRootBranchId(action.narrative);
      const resolved = getResolvedKeys(action.narrative, branchId);
      const existingIdx = state.narratives.findIndex((n) => n.id === action.narrative.id);
      const narratives = existingIdx >= 0
        ? state.narratives.map((n, i) => (i === existingIdx ? entry : n))
        : [...state.narratives, entry];
      return {
        ...state,
        narratives,
        activeNarrativeId: action.narrative.id,
        activeNarrative: action.narrative,
        activeBranchId: branchId,
        resolvedSceneKeys: resolved,
        currentSceneIndex: Math.max(0, resolved.length - 1),
        wizardOpen: false,
      };
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
          totalScenesGenerated: 0,
          totalWorldExpansions: 0,
          startingSceneCount: state.resolvedSceneKeys.length,
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

    case 'LOG_AUTO_CYCLE':
      return state.autoRunState
        ? {
            ...state,
            autoRunState: {
              ...state.autoRunState,
              currentCycle: state.autoRunState.currentCycle + 1,
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
      }).catch((err) => console.error('[store] Failed to update cover image:', err));
      return { ...state, narratives: updatedNarratives };
    }

    case 'SET_SCENE_IMAGE':
      return updateNarrative(state, (n) => {
        const scene = n.scenes[action.sceneId];
        if (!scene) return n;
        return { ...n, scenes: { ...n.scenes, [action.sceneId]: { ...scene, imageUrl: action.imageUrl } } };
      });

    case 'SET_CHARACTER_IMAGE':
      return updateNarrative(state, (n) => {
        const char = n.characters[action.characterId];
        if (!char) return n;
        return { ...n, characters: { ...n.characters, [action.characterId]: { ...char, imageUrl: action.imageUrl } } };
      });

    case 'SET_LOCATION_IMAGE':
      return updateNarrative(state, (n) => {
        const loc = n.locations[action.locationId];
        if (!loc) return n;
        return { ...n, locations: { ...n.locations, [action.locationId]: { ...loc, imageUrl: action.imageUrl } } };
      });

    case 'SET_IMAGE_STYLE':
      return updateNarrative(state, (n) => ({ ...n, imageStyle: action.style }));

    case 'SET_RULES':
      return updateNarrative(state, (n) => ({ ...n, rules: action.rules }));

    case 'SET_STORY_SETTINGS':
      return updateNarrative(state, (n) => ({ ...n, storySettings: action.settings }));

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

    case 'HYDRATE_ANALYSIS_JOBS':
      return { ...state, analysisJobs: action.jobs };

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

  // Wire analysis runner dispatch
  useEffect(() => {
    analysisRunnerRef.setDispatch(dispatch);
  }, [dispatch]);

  // Hydrate persisted narratives from IndexedDB on mount
  useEffect(() => {
    async function hydrate() {
      // Migrate from localStorage if needed (one-time)
      await migrateFromLocalStorage();

      let persisted: NarrativeState[] = [];
      try {
        persisted = await loadNarratives();
      } catch (err) {
        console.error('[store] Hydration failed:', err);
      }
      const persistedById = new Map(persisted.map((n) => [n.id, n]));

      // Load bundled narratives from /public manifests (parallel fetches)
      async function loadManifest(dir: string, idSet: Set<string>) {
        try {
          const res = await fetch(`/${dir}/manifest.json`);
          if (!res.ok) { console.warn(`[store] manifest ${dir} returned ${res.status}`); return []; }
          const files: string[] = await res.json();
          const results = await Promise.allSettled(
            files.map(async (file) => {
              const r = await fetch(`/${dir}/${file}`);
              if (!r.ok) return null;
              return (await r.json()) as NarrativeState;
            })
          );
          const entries: NarrativeEntry[] = [];
          for (const result of results) {
            if (result.status !== 'fulfilled' || !result.value) continue;
            const narrative = result.value;
            bundledNarratives.set(narrative.id, narrative);
            SEED_IDS.add(narrative.id);
            idSet.add(narrative.id);
            const saved = persistedById.get(narrative.id);
            entries.push(narrativeToEntry(saved ?? narrative));
          }
          return entries;
        } catch (err) { console.warn(`[store] loadManifest ${dir} failed:`, err); return []; }
      }

      const [playgroundEntries, analysisEntries] = await Promise.all([
        loadManifest('playgrounds', PLAYGROUND_IDS),
        loadManifest('works', ANALYSIS_IDS),
      ]);

      const userEntries = persisted
        .filter((n) => !SEED_IDS.has(n.id) && !PLAYGROUND_IDS.has(n.id) && !ANALYSIS_IDS.has(n.id))
        .map(narrativeToEntry);

      // Initialize Markov chain presets from analysed works
      const worksForPresets: { key: string; name: string; narrative: NarrativeState }[] = [];
      for (const [id, narrative] of bundledNarratives) {
        if (ANALYSIS_IDS.has(id)) {
          const key = narrative.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');
          worksForPresets.push({ key, name: narrative.title, narrative });
        }
      }
      if (worksForPresets.length > 0) initMatrixPresets(worksForPresets);

      dispatch({ type: 'HYDRATE_NARRATIVES', entries: [...playgroundEntries, ...analysisEntries, ...userEntries] });

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
    load().catch((err) => console.error('[store] Failed to load narrative:', err));
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
      console.error('[store] Failed to persist narrative:', err);
    });
  }, [state.activeNarrative]);

  // Persist active narrative ID whenever it changes
  useEffect(() => {
    saveActiveNarrativeId(state.activeNarrativeId).catch((err) => {
      console.error('[store] Failed to persist active narrative ID:', err);
    });
  }, [state.activeNarrativeId]);

  // Persist active branch ID whenever it changes (skip null to avoid race with SET_ACTIVE_NARRATIVE)
  useEffect(() => {
    if (state.activeBranchId === null) return;
    saveActiveBranchId(state.activeBranchId).catch((err) => {
      console.error('[store] Failed to persist active branch ID:', err);
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

  // Persist analysis jobs whenever they change
  const prevAnalysisJobsRef = useRef(state.analysisJobs);
  useEffect(() => {
    if (state.analysisJobs === prevAnalysisJobsRef.current) return;
    prevAnalysisJobsRef.current = state.analysisJobs;
    saveAnalysisJobs(state.analysisJobs).catch((err) => {
      console.error('[store] Failed to persist analysis jobs:', err);
    });
  }, [state.analysisJobs]);

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
