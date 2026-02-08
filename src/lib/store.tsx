'use client';

import React, { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react';
import type { AppState, ControlMode, InspectorContext, NarrativeState, NarrativeEntry, WizardStep, WizardData, Scene, Arc, Branch, Character, Location, Thread, RelationshipEdge, GraphViewMode, AutoConfig, AutoRunState, AutoRunLog, WorldBuildCommit } from '@/types/narrative';
import { seedNarrative } from '@/data/seed-ri';
import { seedGOT } from '@/data/seed-got';
import { seedLOTR } from '@/data/seed-lotr';
import { seedHP } from '@/data/seed-hp';
import { seedSW } from '@/data/seed-sw';
import { resolveSceneSequence, nextId } from '@/lib/narrative-utils';
import { loadNarratives, saveNarrative, deleteNarrative as deletePersisted, loadNarrative, saveActiveNarrativeId, loadActiveNarrativeId } from '@/lib/persistence';

const ALL_SEEDS: NarrativeState[] = [seedGOT, seedLOTR, seedHP, seedSW, seedNarrative];

function narrativeToEntry(n: NarrativeState): NarrativeEntry {
  const threadValues = Object.values(n.threads);
  return {
    id: n.id,
    title: n.title,
    description: n.description,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    sceneCount: Object.keys(n.scenes).length,
    coverThread: threadValues[0]?.description ?? '',
    coverImageUrl: n.coverImageUrl,
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

const SEED_IDS = new Set(ALL_SEEDS.map((s) => s.id));

function loadNarrativeById(id: string): NarrativeState | null {
  // Prefer persisted version (includes user edits to seeds)
  const persisted = loadNarrative(id);
  if (persisted) return persisted;
  // Fall back to static seed data
  const seed = ALL_SEEDS.find((s) => s.id === id);
  if (seed) return seed;
  return null;
}

// Helper to update the active narrative in state and persist
function withNarrativeUpdate(
  state: AppState,
  updater: (n: NarrativeState) => NarrativeState,
): AppState {
  if (!state.activeNarrative) return state;
  const updated = updater(state.activeNarrative);
  updated.updatedAt = Date.now();
  saveNarrative(updated);
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
 * - knowledgeMutations: add/remove knowledge nodes on characters
 * - threadMutations: update thread statuses
 */
function applySceneMutations(n: NarrativeState, scenes: Scene[]): NarrativeState {
  let relationships = [...n.relationships];
  const characters = { ...n.characters };
  const threads = { ...n.threads };

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
    for (const km of scene.knowledgeMutations) {
      const char = characters[km.characterId];
      if (!char) continue;

      if (km.action === 'added') {
        // Add knowledge node if it doesn't already exist
        const exists = char.knowledge.nodes.some((kn) => kn.id === km.nodeId);
        if (!exists) {
          characters[km.characterId] = {
            ...char,
            knowledge: {
              ...char.knowledge,
              nodes: [...char.knowledge.nodes, { id: km.nodeId, type: km.nodeType ?? 'learned', content: km.content }],
            },
          };
        }
      } else if (km.action === 'removed') {
        characters[km.characterId] = {
          ...char,
          knowledge: {
            ...char.knowledge,
            nodes: char.knowledge.nodes.filter((kn) => kn.id !== km.nodeId),
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
  }

  return { ...n, relationships, characters, threads };
}

export const SEED_NARRATIVE_IDS = SEED_IDS;

const seedRootBranchId = getRootBranchId(seedNarrative);
const seedResolvedKeys = getResolvedKeys(seedNarrative, seedRootBranchId);

const initialState: AppState = {
  narratives: ALL_SEEDS.map(narrativeToEntry),
  activeNarrativeId: seedNarrative.id,
  activeNarrative: seedNarrative,
  controlMode: 'auto',
  isPlaying: false,
  currentSceneIndex: Math.max(0, seedResolvedKeys.length - 1),
  activeBranchId: seedRootBranchId,
  resolvedSceneKeys: seedResolvedKeys,
  inspectorContext: null,
  wizardOpen: false,
  wizardStep: 'premise',
  wizardPrefill: '',
  wizardData: { title: '', premise: '', genres: [], tone: '', setting: '', scale: '', characters: [], locations: [], storyDirection: '' },
  selectedKnowledgeEntity: null,
  autoTimer: 30,
  graphViewMode: 'scene',
  autoConfig: {
    objective: 'explore_and_resolve',
    endConditions: [{ type: 'scene_count', target: 50 }],
    minArcLength: 2,
    maxArcLength: 5,
    worldBuildInterval: 3,
    maxActiveThreads: 6,
    threadStagnationThreshold: 5,
    arcDirectionPrompt: '',
    storyDirectionPrompt: '',
    toneGuidance: '',
    narrativeConstraints: '',
    characterRotationEnabled: true,
    minScenesBetweenCharacterFocus: 3,
    enforceWorldBuildUsage: true,
  },
  autoRunState: null,
  apiLogs: [],
};

// ── Actions ──────────────────────────────────────────────────────────────────
type Action =
  | { type: 'HYDRATE_NARRATIVES'; entries: NarrativeEntry[] }
  | { type: 'SET_ACTIVE_NARRATIVE'; id: string }
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
  | { type: 'UPDATE_SCENE'; sceneId: string; updates: Partial<Pick<Scene, 'summary' | 'prose' | 'events' | 'locationId' | 'participantIds'>> }
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
  | { type: 'ADD_RELATIONSHIP'; relationship: RelationshipEdge }
  | { type: 'REMOVE_RELATIONSHIP'; from: string; to: string }
  | { type: 'BULK_ADD_SCENES'; scenes: Scene[]; arc: Arc; branchId: string }
  | { type: 'EXPAND_WORLD'; wxId: string; characters: Character[]; locations: Location[]; threads: Thread[]; relationships: RelationshipEdge[]; branchId: string }
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
  | { type: 'SET_IMAGE_STYLE'; style: string };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'HYDRATE_NARRATIVES': {
      return { ...state, narratives: action.entries };
    }
    case 'SET_ACTIVE_NARRATIVE': {
      const narrative = loadNarrativeById(action.id);
      const branchId = narrative ? getRootBranchId(narrative) : null;
      const resolved = narrative ? getResolvedKeys(narrative, branchId) : [];
      saveActiveNarrativeId(action.id);
      return {
        ...state,
        activeNarrativeId: action.id,
        activeNarrative: narrative,
        activeBranchId: branchId,
        resolvedSceneKeys: resolved,
        currentSceneIndex: resolved.length - 1,
        inspectorContext: null,
        selectedKnowledgeEntity: null,
      };
    }
    case 'CLEAR_ACTIVE_NARRATIVE':
      saveActiveNarrativeId(null);
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
      return { ...state, wizardOpen: true, wizardStep: 'premise', wizardPrefill: action.prefill ?? '', wizardData: { title: '', premise: action.prefill ?? '', genres: [], tone: '', setting: '', scale: '', characters: [], locations: [], storyDirection: '' } };
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

      // Use a stable ID based on narrative id to be idempotent under strict mode
      const wxId = nextId('WX', Object.keys(n.worldBuilds), 3);
      if (rootBranch && !n.worldBuilds[wxId] && (allChars.length > 0 || allLocs.length > 0 || allThreads.length > 0)) {
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
      saveNarrative(mutated);
      saveActiveNarrativeId(mutated.id);
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
      deletePersisted(action.id);
      const isSeed = SEED_IDS.has(action.id);
      const isActive = state.activeNarrativeId === action.id;

      if (isSeed) {
        // Reset seed to original static data instead of removing it
        const originalSeed = ALL_SEEDS.find((s) => s.id === action.id)!;
        const resetEntry = narrativeToEntry(originalSeed);
        return {
          ...state,
          narratives: state.narratives.map((n) => n.id === action.id ? resetEntry : n),
          activeNarrativeId: isActive ? null : state.activeNarrativeId,
          activeNarrative: isActive ? null : state.activeNarrative,
        };
      }

      if (isActive) saveActiveNarrativeId(null);
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
      return withNarrativeUpdate(state, (n) => ({
        ...n,
        title: action.title ?? n.title,
        description: action.description ?? n.description,
        worldSummary: action.worldSummary ?? n.worldSummary,
      }));

    // ── CRUD: Scenes ──────────────────────────────────────────────────────
    case 'UPDATE_SCENE':
      return withNarrativeUpdate(state, (n) => {
        const scene = n.scenes[action.sceneId];
        if (!scene) return n;
        return { ...n, scenes: { ...n.scenes, [action.sceneId]: { ...scene, ...action.updates } } };
      });

    case 'CREATE_SCENE': {
      const newState = withNarrativeUpdate(state, (n) => {
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
      const newState = withNarrativeUpdate(state, (n) => {
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
      return withNarrativeUpdate(state, (n) => {
        const arc = n.arcs[action.arcId];
        if (!arc) return n;
        return { ...n, arcs: { ...n.arcs, [action.arcId]: { ...arc, ...action.updates } } };
      });

    case 'CREATE_ARC':
      return withNarrativeUpdate(state, (n) => ({
        ...n, arcs: { ...n.arcs, [action.arc.id]: action.arc },
      }));

    case 'DELETE_ARC':
      return withNarrativeUpdate(state, (n) => {
        const { [action.arcId]: _, ...restArcs } = n.arcs;
        return { ...n, arcs: restArcs };
      });

    // ── CRUD: Characters ──────────────────────────────────────────────────
    case 'UPDATE_CHARACTER':
      return withNarrativeUpdate(state, (n) => {
        const char = n.characters[action.characterId];
        if (!char) return n;
        return { ...n, characters: { ...n.characters, [action.characterId]: { ...char, ...action.updates } } };
      });

    case 'CREATE_CHARACTER':
      return withNarrativeUpdate(state, (n) => ({
        ...n, characters: { ...n.characters, [action.character.id]: action.character },
      }));

    case 'DELETE_CHARACTER':
      return withNarrativeUpdate(state, (n) => {
        const { [action.characterId]: _, ...rest } = n.characters;
        return { ...n, characters: rest };
      });

    // ── CRUD: Locations ───────────────────────────────────────────────────
    case 'UPDATE_LOCATION':
      return withNarrativeUpdate(state, (n) => {
        const loc = n.locations[action.locationId];
        if (!loc) return n;
        return { ...n, locations: { ...n.locations, [action.locationId]: { ...loc, ...action.updates } } };
      });

    case 'CREATE_LOCATION':
      return withNarrativeUpdate(state, (n) => ({
        ...n, locations: { ...n.locations, [action.location.id]: action.location },
      }));

    case 'DELETE_LOCATION':
      return withNarrativeUpdate(state, (n) => {
        const { [action.locationId]: _, ...rest } = n.locations;
        return { ...n, locations: rest };
      });

    // ── CRUD: Threads ─────────────────────────────────────────────────────
    case 'UPDATE_THREAD':
      return withNarrativeUpdate(state, (n) => {
        const thread = n.threads[action.threadId];
        if (!thread) return n;
        return { ...n, threads: { ...n.threads, [action.threadId]: { ...thread, ...action.updates } } };
      });

    case 'CREATE_THREAD':
      return withNarrativeUpdate(state, (n) => ({
        ...n, threads: { ...n.threads, [action.thread.id]: action.thread },
      }));

    case 'DELETE_THREAD':
      return withNarrativeUpdate(state, (n) => {
        const { [action.threadId]: _, ...rest } = n.threads;
        return { ...n, threads: rest };
      });

    // ── CRUD: Branches ────────────────────────────────────────────────────
    case 'CREATE_BRANCH': {
      const newState = withNarrativeUpdate(state, (n) => ({
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
      return withNarrativeUpdate(state, (n) => {
        const { [action.branchId]: _, ...rest } = n.branches;
        return { ...n, branches: rest };
      });
    }

    // ── CRUD: Relationships ───────────────────────────────────────────────
    case 'ADD_RELATIONSHIP':
      return withNarrativeUpdate(state, (n) => ({
        ...n, relationships: [...n.relationships, action.relationship],
      }));

    case 'REMOVE_RELATIONSHIP':
      return withNarrativeUpdate(state, (n) => ({
        ...n, relationships: n.relationships.filter((r) => !(r.from === action.from && r.to === action.to)),
      }));

    // ── Bulk: AI-generated scenes ─────────────────────────────────────────
    case 'BULK_ADD_SCENES': {
      const newState = withNarrativeUpdate(state, (n) => {
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
      };

      const newState = withNarrativeUpdate(state, (n) => {
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
      saveNarrative(action.narrative);
      saveActiveNarrativeId(action.narrative.id);
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
      let updatedActive = state.activeNarrative;
      if (updatedActive && updatedActive.id === action.narrativeId) {
        updatedActive = { ...updatedActive, coverImageUrl: action.imageUrl };
        saveNarrative(updatedActive);
      } else {
        // Update in persistence even if not active
        const stored = loadNarrative(action.narrativeId);
        if (stored) {
          saveNarrative({ ...stored, coverImageUrl: action.imageUrl });
        }
      }
      return { ...state, narratives: updatedNarratives, activeNarrative: updatedActive };
    }

    case 'SET_SCENE_IMAGE':
      return withNarrativeUpdate(state, (n) => {
        const scene = n.scenes[action.sceneId];
        if (!scene) return n;
        return { ...n, scenes: { ...n.scenes, [action.sceneId]: { ...scene, imageUrl: action.imageUrl } } };
      });

    case 'SET_CHARACTER_IMAGE':
      return withNarrativeUpdate(state, (n) => {
        const char = n.characters[action.characterId];
        if (!char) return n;
        return { ...n, characters: { ...n.characters, [action.characterId]: { ...char, imageUrl: action.imageUrl } } };
      });

    case 'SET_LOCATION_IMAGE':
      return withNarrativeUpdate(state, (n) => {
        const loc = n.locations[action.locationId];
        if (!loc) return n;
        return { ...n, locations: { ...n.locations, [action.locationId]: { ...loc, imageUrl: action.imageUrl } } };
      });

    case 'SET_IMAGE_STYLE':
      return withNarrativeUpdate(state, (n) => ({ ...n, imageStyle: action.style }));

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

  // Wire API logger to store
  useEffect(() => {
    import('@/lib/api-logger').then(({ onApiLog, onApiLogUpdate }) => {
      onApiLog((entry) => dispatch({ type: 'LOG_API_CALL', entry }));
      onApiLogUpdate((id, updates) => dispatch({ type: 'UPDATE_API_LOG', id, updates }));
    });
  }, []);

  // Hydrate persisted narratives from localStorage on mount
  useEffect(() => {
    const persisted = loadNarratives();
    const persistedById = new Map(persisted.map((n) => [n.id, n]));

    // For seeds, prefer persisted version if it exists (user made edits), otherwise use static
    const seedEntries = ALL_SEEDS.map((seed) => {
      const saved = persistedById.get(seed.id);
      return narrativeToEntry(saved ?? seed);
    });

    const userEntries = persisted
      .filter((n) => !SEED_IDS.has(n.id))
      .map(narrativeToEntry);

    dispatch({ type: 'HYDRATE_NARRATIVES', entries: [...seedEntries, ...userEntries] });

    // Restore last active narrative
    const savedActiveId = loadActiveNarrativeId();
    if (savedActiveId) {
      dispatch({ type: 'SET_ACTIVE_NARRATIVE', id: savedActiveId });
    }
  }, []);

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

  return (
    <StoreContext.Provider value={{ state, dispatch }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
