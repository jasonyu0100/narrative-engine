"use client";

import { assetManager } from "@/lib/asset-manager";
import { initBeatProfilePresets } from "@/lib/beat-profiles";
import { applyWorldDelta } from "@/lib/world-graph";
import { initMechanismProfilePresets } from "@/lib/mechanism-profiles";
import {
  classifyArchetype,
  classifyNarrativeShape,
  classifyScale,
  classifyWorldDensity,
  computeDeliveryCurve,
  computeForceSnapshots,
  computeRawForceTotals,
  computeSwingMagnitudes,
  FORCE_REFERENCE_MEANS,
  gradeForces,
  nextId,
  resolveEntrySequence,
  resolvePlanForBranch,
  resolveProseForBranch,
} from "@/lib/narrative-utils";
import { initMatrixPresets } from "@/lib/pacing-profile";
import {
  deleteAnalysisApiLogs,
  deleteApiLogs,
  deleteNarrative as deletePersisted,
  loadActiveBranchId,
  loadActiveNarrativeId,
  loadAnalysisJobs,
  loadNarrative,
  loadNarratives,
  loadSearchState,
  migrateFromLocalStorage,
  saveNarrative as persistNarrative,
  saveActiveBranchId,
  saveActiveNarrativeId,
  saveAnalysisJobs,
  saveSearchState,
} from "@/lib/persistence";
import {
  applySystemDelta,
  sanitizeSystemDelta,
} from "@/lib/system-graph";
import { logError, logWarning } from "@/lib/system-logger";
import { applyThreadDelta } from "@/lib/thread-log";
import type {
  AnalysisJob,
  AppState,
  Arc,
  Artifact,
  AutoConfig,
  AutoRunLog,
  BeatPlan,
  BeatProseMap,
  Branch,
  BranchPlan,
  Character,
  ChatMessage,
  ChatThread,
  WorldDelta,
  GraphViewMode,
  InspectorContext,
  Location,
  NarrativeEntry,
  NarrativeState,
  NarrativeViewState,
  Note,
  OwnershipDelta,
  PlanEvaluation,
  ProseEvaluation,
  ProseProfile,
  ProseScore,
  ReasoningGraphSnapshot,
  RelationshipEdge,
  RelationshipDelta,
  Scene,
  SearchQuery,
  StorySettings,
  StructureReview,
  SystemEdge,
  SystemGraph,
  SystemDelta,
  SystemNode,
  Thread,
  ThreadDelta,
  TieDelta,
  WorldBuild,
} from "@/types/narrative";
import { isScene, resolveEntry } from "@/types/narrative";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

// Bundled narratives loaded at runtime from /public manifests
const bundledNarratives = new Map<string, NarrativeState>();

function computeDerivedEntities(
  worldBuilds: Record<string, WorldBuild>,
  scenes: Record<string, Scene>,
  resolvedKeys: string[],
): {
  characters: Record<string, Character>;
  locations: Record<string, Location>;
  threads: Record<string, Thread>;
  artifacts: Record<string, Artifact>;
  relationships: RelationshipEdge[];
  systemGraph: SystemGraph;
} {
  const characters: Record<string, Character> = {};
  const locations: Record<string, Location> = {};
  const threads: Record<string, Thread> = {};
  const artifacts: Record<string, Artifact> = {};
  let relationships: RelationshipEdge[] = [];
  const wkNodes: Record<string, SystemNode> = {};
  const wkEdges: SystemEdge[] = [];

  // Graph derivation uses the shared sanitize→apply pipeline so that
  // self-loops, orphans, bad fields, and cross-delta duplicates are all
  // filtered consistently with the generation and analysis pipelines.
  const seenWkEdgeKeys = new Set<string>();
  const applySystemDeltaEntry = (wkm: SystemDelta) => {
    if (!wkm) return;
    // Clone so we don't mutate the entry's stored delta in place during derivation.
    const clone: SystemDelta = {
      addedNodes: [...(wkm.addedNodes ?? [])],
      addedEdges: [...(wkm.addedEdges ?? [])],
    };
    // Valid ids at this moment: everything already in the accumulating graph
    // plus anything this delta is about to contribute.
    const validIds = new Set<string>(Object.keys(wkNodes));
    for (const n of clone.addedNodes) if (n?.id) validIds.add(n.id);
    sanitizeSystemDelta(clone, validIds, seenWkEdgeKeys);
    applySystemDelta({ nodes: wkNodes, edges: wkEdges }, clone);
  };

  for (const key of resolvedKeys) {
    const wb = worldBuilds[key];
    if (wb) {
      for (const c of wb.expansionManifest.newCharacters) {
        characters[c.id] = {
          ...c,
          world: {
            nodes: c.world?.nodes ?? {},
            edges: c.world?.edges ?? [],
          },
        };
      }
      for (const l of wb.expansionManifest.newLocations) {
        locations[l.id] = {
          ...l,
          tiedCharacterIds: l.tiedCharacterIds ?? [],
          world: {
            nodes: l.world?.nodes ?? {},
            edges: l.world?.edges ?? [],
          },
        };
      }
      for (const t of wb.expansionManifest.newThreads) {
        threads[t.id] = { ...t };
      }
      // Collect artifacts — merge world if artifact already exists
      for (const a of wb.expansionManifest.newArtifacts ?? []) {
        const existing = artifacts[a.id];
        const aCont = {
          nodes: a.world?.nodes ?? {},
          edges: a.world?.edges ?? [],
        };
        if (existing) {
          artifacts[a.id] = {
            ...existing,
            ...a,
            world: {
              nodes: { ...existing.world.nodes, ...aCont.nodes },
              edges: [...existing.world.edges, ...aCont.edges],
            },
          };
        } else {
          artifacts[a.id] = {
            ...a,
            threadIds: a.threadIds ?? [],
            world: aCont,
          };
        }
      }
      // Collect system knowledge deltas
      applySystemDeltaEntry(
        wb.expansionManifest.systemDeltas ?? {
          addedNodes: [],
          addedEdges: [],
        },
      );
      // Apply thread deltas on existing threads
      for (const tm of wb.expansionManifest.threadDeltas ?? []) {
        const thread = threads[tm.threadId];
        if (!thread) continue;
        threads[tm.threadId] = {
          ...thread,
          status: tm.to,
          threadLog: applyThreadDelta(thread.threadLog, tm),
        };
      }
      // Apply expansion deltas on existing entities
      for (const km of wb.expansionManifest.worldDeltas ?? []) {
        const char = characters[km.entityId];
        const loc = locations[km.entityId];
        const art = artifacts[km.entityId];
        if (char)
          characters[km.entityId] = {
            ...char,
            world: applyWorldDelta(char.world, km),
          };
        else if (loc)
          locations[km.entityId] = {
            ...loc,
            world: applyWorldDelta(loc.world, km),
          };
        else if (art)
          artifacts[km.entityId] = {
            ...art,
            world: applyWorldDelta(art.world, km),
          };
      }
      for (const rm of wb.expansionManifest.relationshipDeltas ?? []) {
        const idx = relationships.findIndex(
          (r) => r.from === rm.from && r.to === rm.to,
        );
        if (idx >= 0) {
          const existing = relationships[idx];
          relationships = [
            ...relationships.slice(0, idx),
            {
              ...existing,
              type: rm.type,
              valence: Math.max(
                -1,
                Math.min(1, existing.valence + rm.valenceDelta),
              ),
            },
            ...relationships.slice(idx + 1),
          ];
        } else {
          relationships.push({
            from: rm.from,
            to: rm.to,
            type: rm.type,
            valence: Math.max(-1, Math.min(1, rm.valenceDelta)),
          });
        }
      }
      for (const om of wb.expansionManifest.ownershipDeltas ?? []) {
        const art = artifacts[om.artifactId];
        if (art) artifacts[om.artifactId] = { ...art, parentId: om.toId };
      }
      for (const mm of wb.expansionManifest.tieDeltas ?? []) {
        const loc = locations[mm.locationId];
        if (loc) {
          if (
            mm.action === "add" &&
            !loc.tiedCharacterIds.includes(mm.characterId)
          ) {
            locations[mm.locationId] = {
              ...loc,
              tiedCharacterIds: [...loc.tiedCharacterIds, mm.characterId],
            };
          } else if (mm.action === "remove") {
            locations[mm.locationId] = {
              ...loc,
              tiedCharacterIds: loc.tiedCharacterIds.filter(
                (id) => id !== mm.characterId,
              ),
            };
          }
        }
      }
    } else {
      const scene = scenes[key];
      if (!scene) continue;

      // Process introduced entities BEFORE deltas (so deltas can reference them)
      for (const c of scene.newCharacters ?? []) {
        if (!characters[c.id]) {
          characters[c.id] = {
            ...c,
            world: c.world ?? { nodes: {}, edges: [] },
          };
        }
      }
      for (const l of scene.newLocations ?? []) {
        if (!locations[l.id]) {
          locations[l.id] = {
            ...l,
            tiedCharacterIds: l.tiedCharacterIds ?? [],
            world: l.world ?? { nodes: {}, edges: [] },
          };
        }
      }
      for (const a of scene.newArtifacts ?? []) {
        if (!artifacts[a.id]) {
          artifacts[a.id] = {
            ...a,
            threadIds: a.threadIds ?? [],
            world: a.world ?? { nodes: {}, edges: [] },
          };
        }
      }
      for (const t of scene.newThreads ?? []) {
        if (!threads[t.id]) {
          threads[t.id] = {
            ...t,
            status: "latent", // Force latent status for scene-introduced threads
            threadLog: t.threadLog ?? { nodes: {}, edges: [] },
          };
        }
      }

      for (const km of scene.worldDeltas ?? []) {
        // World deltas can target characters, locations, or artifacts
        const char = characters[km.entityId];
        const loc = locations[km.entityId];
        const art = artifacts[km.entityId];
        if (char) {
          characters[km.entityId] = {
            ...char,
            world: applyWorldDelta(char.world, km),
          };
        } else if (loc) {
          locations[km.entityId] = {
            ...loc,
            world: applyWorldDelta(loc.world, km),
          };
        } else if (art) {
          artifacts[km.entityId] = {
            ...art,
            world: applyWorldDelta(art.world, km),
          };
        }
      }
      for (const tm of scene.threadDeltas ?? []) {
        const thread = threads[tm.threadId];
        if (!thread) continue;
        threads[tm.threadId] = {
          ...thread,
          status: tm.to,
          threadLog: applyThreadDelta(thread.threadLog, tm),
        };
      }
      // Apply relationship deltas from scene
      for (const rm of scene.relationshipDeltas ?? []) {
        const idx = relationships.findIndex(
          (r) => r.from === rm.from && r.to === rm.to,
        );
        if (idx >= 0) {
          const existing = relationships[idx];
          relationships = [
            ...relationships.slice(0, idx),
            {
              ...existing,
              type: rm.type,
              valence: Math.max(
                -1,
                Math.min(1, existing.valence + rm.valenceDelta),
              ),
            },
            ...relationships.slice(idx + 1),
          ];
        } else {
          relationships.push({
            from: rm.from,
            to: rm.to,
            type: rm.type,
            valence: Math.max(-1, Math.min(1, rm.valenceDelta)),
          });
        }
      }
      // Apply system knowledge deltas from scene delta
      if (scene.systemDeltas) {
        applySystemDeltaEntry(scene.systemDeltas);
      }
      // Apply ownership deltas from scene
      for (const om of scene.ownershipDeltas ?? []) {
        const art = artifacts[om.artifactId];
        if (art) {
          artifacts[om.artifactId] = { ...art, parentId: om.toId };
        }
      }
      // Apply tie deltas from scene
      for (const mm of scene.tieDeltas ?? []) {
        const loc = locations[mm.locationId];
        if (loc) {
          if (
            mm.action === "add" &&
            !loc.tiedCharacterIds.includes(mm.characterId)
          ) {
            locations[mm.locationId] = {
              ...loc,
              tiedCharacterIds: [...loc.tiedCharacterIds, mm.characterId],
            };
          } else if (mm.action === "remove") {
            locations[mm.locationId] = {
              ...loc,
              tiedCharacterIds: loc.tiedCharacterIds.filter(
                (id) => id !== mm.characterId,
              ),
            };
          }
        }
      }
    }
  }

  // Compute threadIds on all entities from thread participants
  for (const thread of Object.values(threads)) {
    for (const anchor of thread.participants) {
      if (anchor.type === "character" && characters[anchor.id]) {
        const char = characters[anchor.id];
        const charThreadIds = char.threadIds ?? [];
        if (!charThreadIds.includes(thread.id)) {
          characters[anchor.id] = {
            ...char,
            threadIds: [...charThreadIds, thread.id],
          };
        }
      } else if (anchor.type === "location" && locations[anchor.id]) {
        const loc = locations[anchor.id];
        const locThreadIds = loc.threadIds ?? [];
        if (!locThreadIds.includes(thread.id)) {
          locations[anchor.id] = {
            ...loc,
            threadIds: [...locThreadIds, thread.id],
          };
        }
      } else if (anchor.type === "artifact" && artifacts[anchor.id]) {
        const art = artifacts[anchor.id];
        const artThreadIds = art.threadIds ?? [];
        if (!artThreadIds.includes(thread.id)) {
          artifacts[anchor.id] = {
            ...art,
            threadIds: [...artThreadIds, thread.id],
          };
        }
      }
    }
  }

  // Strip orphan edges — edges referencing node IDs that were never defined as actual nodes
  const validWkEdges = wkEdges.filter((e) => wkNodes[e.from] && wkNodes[e.to]);

  return {
    characters,
    locations,
    threads,
    artifacts,
    relationships,
    systemGraph: { nodes: wkNodes, edges: validWkEdges },
  };
}

export function withDerivedEntities(
  n: NarrativeState,
  resolvedKeys: string[],
): NarrativeState {
  const derived = computeDerivedEntities(n.worldBuilds, n.scenes, resolvedKeys);
  return {
    ...n,
    characters: derived.characters,
    locations: derived.locations,
    threads: derived.threads,
    artifacts: derived.artifacts,
    relationships: derived.relationships,
    systemGraph: derived.systemGraph,
  };
}

export function narrativeToEntry(n: NarrativeState): NarrativeEntry {
  const threadValues = Object.values(n.threads);

  // Compute shape, archetype, and score from scenes
  const branchId = getRootBranchId(n);
  const keys = branchId
    ? resolveEntrySequence(n.branches, branchId)
    : [...Object.keys(n.scenes), ...Object.keys(n.worldBuilds)];
  const allScenes = keys
    .map((k) => resolveEntry(n, k))
    .filter((e): e is Scene => !!e && isScene(e));

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
  const allEntities = [
    ...Object.values(n.characters),
    ...Object.values(n.locations),
    ...Object.values(n.artifacts ?? {}),
  ];
  const entityContinuityNodes = allEntities.reduce(
    (sum, e) => sum + Object.keys(e.world?.nodes ?? {}).length,
    0,
  );
  const entityContinuityEdges = allEntities.reduce(
    (sum, e) => sum + (e.world?.edges?.length ?? 0),
    0,
  );
  const density = classifyWorldDensity(
    allScenes.length,
    Object.keys(n.characters).length,
    Object.keys(n.locations).length,
    Object.keys(n.threads).length,
    Object.keys(n.systemGraph?.nodes ?? {}).length,
    entityContinuityNodes,
    entityContinuityEdges,
  );
  densityKey = density.key;
  densityName = density.name;

  if (allScenes.length >= 3) {
    const raw = computeRawForceTotals(allScenes);
    const rawForces = raw.fate.map((_, i) => ({
      fate: raw.fate[i],
      world: raw.world[i],
      system: raw.system[i],
    }));
    const swings = computeSwingMagnitudes(rawForces, FORCE_REFERENCE_MEANS);
    const forceMap = computeForceSnapshots(allScenes);
    const ordered = allScenes.map(
      (s) => forceMap[s.id] ?? { fate: 0, world: 0, system: 0 },
    );
    const deliveryPoints = computeDeliveryCurve(ordered);
    const grades = gradeForces(raw.fate, raw.world, raw.system, swings);

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
    coverThread: threadValues[0]?.description ?? "",
    coverImageUrl: n.coverImageUrl,
    shapeKey,
    shapeName,
    shapeCurve,
    archetypeKey,
    archetypeName,
    overallScore,
    scaleKey,
    scaleName,
    densityKey,
    densityName,
  };
}

function getRootBranchId(n: NarrativeState): string | null {
  const root = Object.values(n.branches).find((b) => b.parentBranchId === null);
  return root?.id ?? null;
}

function getResolvedKeys(n: NarrativeState, branchId: string | null): string[] {
  if (!branchId)
    return [...Object.keys(n.scenes), ...Object.keys(n.worldBuilds)];
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
      e.id === updated.id
        ? narrativeToEntry(
            withDerivedEntities(updated, state.resolvedEntryKeys),
          )
        : e,
    ),
  };
}

export const SEED_NARRATIVE_IDS = SEED_IDS;
export const PLAYGROUND_NARRATIVE_IDS = PLAYGROUND_IDS;
export const ANALYSIS_NARRATIVE_IDS = ANALYSIS_IDS;

const defaultViewState: NarrativeViewState = {
  activeBranchId: null,
  currentSceneIndex: 0,
  inspectorContext: null,
  inspectorHistory: [],
  selectedKnowledgeEntity: null,
  selectedThreadLog: null,
  currentSearchQuery: null,
  currentResultIndex: 0,
  searchFocusMode: false,
  activeChatThreadId: null,
  activeNoteId: null,
  autoRunState: null,
  isPlaying: false,
};

const initialState: AppState = {
  narratives: [],
  activeNarrativeId: null,
  activeNarrative: null,
  analysisJobs: [],
  graphViewMode: "search",
  autoConfig: {
    endConditions: [{ type: "scene_count", target: 50 }],
    minArcLength: 2,
    maxArcLength: 5,
    maxActiveThreads: 6,
    threadStagnationThreshold: 5,
    direction: "",
    toneGuidance: "",
    narrativeConstraints: "",
    characterRotationEnabled: true,
    minScenesBetweenCharacterFocus: 3,
  },
  viewState: defaultViewState,
  resolvedEntryKeys: [],
};

// ── Actions ──────────────────────────────────────────────────────────────────
export type Action =
  | { type: "HYDRATE_NARRATIVES"; entries: NarrativeEntry[] }
  | { type: "ADD_NARRATIVE_ENTRY"; entry: NarrativeEntry }
  | { type: "SET_ACTIVE_NARRATIVE"; id: string }
  | {
      type: "LOADED_NARRATIVE";
      narrative: NarrativeState;
      savedBranchId?: string | null;
    }
  | { type: "TOGGLE_PLAY" }
  | { type: "NEXT_SCENE" }
  | { type: "PREV_SCENE" }
  | { type: "SET_SCENE_INDEX"; index: number }
  | { type: "SET_INSPECTOR"; context: InspectorContext | null }
  | { type: "INSPECTOR_BACK" }
  | { type: "ADD_NARRATIVE"; narrative: NarrativeState }
  | { type: "DELETE_NARRATIVE"; id: string }
  | { type: "SELECT_KNOWLEDGE_ENTITY"; entityId: string | null }
  | { type: "SELECT_THREAD_LOG"; threadId: string | null }
  | { type: "SET_GRAPH_VIEW_MODE"; mode: GraphViewMode }
  // Search
  | { type: "SET_SEARCH_QUERY"; query: SearchQuery }
  | { type: "SET_SEARCH_RESULT_INDEX"; index: number }
  | { type: "CLEAR_SEARCH" }
  | { type: "TOGGLE_SEARCH_FOCUS" }
  | { type: "SWITCH_BRANCH"; branchId: string }
  // Scene deltas
  | {
      type: "UPDATE_SCENE";
      sceneId: string;
      updates: Partial<
        Pick<
          Scene,
          | "summary"
          | "events"
          | "locationId"
          | "participantIds"
          | "povId"
          | "threadDeltas"
          | "worldDeltas"
          | "relationshipDeltas"
          | "systemDeltas"
          | "characterMovements"
          | "arcId"
          | "proseEmbedding"
          | "summaryEmbedding"
          | "planEmbeddingCentroid"
        >
      > & {
        prose?: string;
        plan?: BeatPlan;
        beatProseMap?: BeatProseMap;
        proseScore?: ProseScore;
      };
      versionType?: "generate" | "rewrite" | "edit";
      sourcePlanVersion?: string;
    }
  | { type: "CLEAR_SCENE_PROSE_VERSION"; sceneId: string; branchId: string }
  | { type: "CLEAR_SCENE_PLAN_VERSION"; sceneId: string; branchId: string }
  | { type: "DELETE_SCENE"; sceneId: string; branchId: string }
  // Branch management
  | { type: "CREATE_BRANCH"; branch: Branch }
  | { type: "DELETE_BRANCH"; branchId: string }
  | { type: "RENAME_BRANCH"; branchId: string; name: string }
  | {
      type: "SET_VERSION_POINTER";
      branchId: string;
      sceneId: string;
      pointerType: "prose" | "plan";
      version: string | undefined;
    }
  | { type: "REMOVE_BRANCH_ENTRY"; entryId: string; branchId: string }
  | {
      type: "SET_STRUCTURE_REVIEW";
      branchId: string;
      evaluation: StructureReview;
    }
  | {
      type: "SET_PROSE_EVALUATION";
      branchId: string;
      evaluation: ProseEvaluation;
    }
  | {
      type: "SET_PLAN_EVALUATION";
      branchId: string;
      evaluation: PlanEvaluation;
    }
  // Bulk AI-generated content
  | { type: "BULK_ADD_SCENES"; scenes: Scene[]; arc: Arc; branchId: string }
  | {
      type: "RECONSTRUCT_BRANCH";
      branchId: string;
      scenes: Scene[];
      arcs: Record<string, Arc>;
    }
  | {
      type: "EXPAND_WORLD";
      worldBuildId: string;
      branchId: string;
      characters: Character[];
      locations: Location[];
      artifacts: Artifact[];
      threads: Thread[];
      threadDeltas?: ThreadDelta[];
      worldDeltas?: WorldDelta[];
      systemDeltas?: SystemDelta;
      relationshipDeltas?: RelationshipDelta[];
      ownershipDeltas?: OwnershipDelta[];
      tieDeltas?: TieDelta[];
      reasoningGraph?: ReasoningGraphSnapshot;
    }
  // Auto mode
  | { type: "SET_AUTO_CONFIG"; config: AutoConfig }
  | { type: "START_AUTO_RUN" }
  | { type: "PAUSE_AUTO_RUN" }
  | { type: "RESUME_AUTO_RUN" }
  | { type: "STOP_AUTO_RUN" }
  | { type: "SET_AUTO_STATUS"; message: string }
  | { type: "LOG_AUTO_CYCLE"; entry: AutoRunLog }
  | { type: "SET_COVER_IMAGE"; narrativeId: string; imageUrl: string }
  | {
      type: "UPDATE_NARRATIVE_META";
      narrativeId: string;
      title?: string;
      description?: string;
    }
  | { type: "SET_SCENE_IMAGE"; sceneId: string; imageUrl: string }
  | { type: "SET_SCENE_AUDIO"; sceneId: string; audioUrl: string }
  | { type: "CLEAR_SCENE_AUDIO"; sceneId: string }
  | { type: "SET_CHARACTER_IMAGE"; characterId: string; imageUrl: string }
  | { type: "SET_LOCATION_IMAGE"; locationId: string; imageUrl: string }
  | { type: "SET_ARTIFACT_IMAGE"; artifactId: string; imageUrl: string }
  | { type: "SET_IMAGE_STYLE"; style: string }
  | { type: "SET_STORY_SETTINGS"; settings: StorySettings }
  | { type: "SET_PROSE_PROFILE"; profile: ProseProfile | undefined }
  | { type: "SET_PATTERNS"; patterns: string[] }
  | { type: "SET_ANTI_PATTERNS"; antiPatterns: string[] }
  | { type: "SET_GENRE"; genre: string }
  | { type: "SET_SUBGENRE"; subgenre: string }
  | { type: "SET_DETECTED_PATTERNS"; genre: string; subgenre: string; patterns: string[]; antiPatterns: string[] }
  // Analysis
  | { type: "ADD_ANALYSIS_JOB"; job: AnalysisJob }
  | { type: "UPDATE_ANALYSIS_JOB"; id: string; updates: Partial<AnalysisJob> }
  | { type: "DELETE_ANALYSIS_JOB"; id: string }
  | { type: "HYDRATE_ANALYSIS_JOBS"; jobs: AnalysisJob[] }
  // Chat threads
  | { type: "CREATE_CHAT_THREAD"; thread: ChatThread }
  | { type: "DELETE_CHAT_THREAD"; threadId: string }
  | { type: "RENAME_CHAT_THREAD"; threadId: string; name: string }
  | { type: "SET_ACTIVE_CHAT_THREAD"; threadId: string | null }
  | {
      type: "UPSERT_CHAT_THREAD";
      threadId: string;
      messages: ChatMessage[];
      name?: string;
    }
  // Notes
  | { type: "CREATE_NOTE"; note: Note }
  | { type: "DELETE_NOTE"; noteId: string }
  | { type: "UPDATE_NOTE"; noteId: string; title?: string; content?: string }
  | { type: "SET_ACTIVE_NOTE"; noteId: string | null }
  // Coordination plan
  | { type: "SET_COORDINATION_PLAN"; branchId: string; plan: BranchPlan | undefined }
  | { type: "CLEAR_COORDINATION_PLAN"; branchId: string }
  | { type: "ADVANCE_COORDINATION_PLAN"; branchId: string }
  | { type: "RESET_COORDINATION_PLAN"; branchId: string }
  | { type: "SET_COORDINATION_PLAN_ARC"; branchId: string; arcIndex: number }
  // Reasoning graph
  | { type: "SET_ARC_REASONING_GRAPH"; arcId: string; reasoningGraph: Arc["reasoningGraph"] };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "HYDRATE_NARRATIVES": {
      return { ...state, narratives: action.entries };
    }
    case "ADD_NARRATIVE_ENTRY": {
      // Upsert entry. We replace even if present because bundled-load dispatches
      // this after mutating SEED_IDS/PLAYGROUND_IDS/ANALYSIS_IDS — the reference
      // change forces a re-render so the UI filters (which read those Sets) pick
      // up the new classification.
      const existing = state.narratives.findIndex((n) => n.id === action.entry.id);
      if (existing >= 0) {
        const next = [...state.narratives];
        next[existing] = action.entry;
        return { ...state, narratives: next };
      }
      return { ...state, narratives: [...state.narratives, action.entry] };
    }
    case "SET_ACTIVE_NARRATIVE": {
      // Just set the ID — the async loading effect will populate the narrative
      if (state.activeNarrativeId === action.id && state.activeNarrative)
        return state;
      return {
        ...state,
        activeNarrativeId: action.id,
        activeNarrative: null, // cleared until async load completes
        resolvedEntryKeys: [],
        viewState: defaultViewState, // Reset all narrative-scoped state
      };
    }
    case "LOADED_NARRATIVE": {
      // Async load completed — populate state
      if (state.activeNarrativeId !== action.narrative.id) return state; // stale
      const savedBranch =
        action.savedBranchId && action.narrative.branches[action.savedBranchId]
          ? action.savedBranchId
          : null;
      const branchId = savedBranch ?? getRootBranchId(action.narrative);
      const resolved = getResolvedKeys(action.narrative, branchId);
      const derivedNarrative = withDerivedEntities(action.narrative, resolved);
      return {
        ...state,
        activeNarrative: derivedNarrative,
        resolvedEntryKeys: resolved,
        viewState: {
          ...state.viewState,
          activeBranchId: branchId,
          currentSceneIndex: resolved.length - 1,
        },
      };
    }
    case "TOGGLE_PLAY":
      return { ...state, viewState: { ...state.viewState, isPlaying: !state.viewState.isPlaying } };
    case "NEXT_SCENE": {
      const max = state.resolvedEntryKeys.length - 1;
      const nextIdx = Math.min(state.viewState.currentSceneIndex + 1, Math.max(0, max));
      return { ...state, viewState: { ...state.viewState, currentSceneIndex: nextIdx } };
    }
    case "PREV_SCENE": {
      const prevIdx = Math.max(state.viewState.currentSceneIndex - 1, 0);
      return { ...state, viewState: { ...state.viewState, currentSceneIndex: prevIdx } };
    }
    case "SET_SCENE_INDEX":
      return { ...state, viewState: { ...state.viewState, currentSceneIndex: action.index } };
    case "SET_INSPECTOR": {
      // Push current context to history stack before navigating (max 20 entries)
      const history = state.viewState.inspectorContext
        ? [...state.viewState.inspectorHistory.slice(-19), state.viewState.inspectorContext]
        : state.viewState.inspectorHistory;
      return {
        ...state,
        viewState: {
          ...state.viewState,
          inspectorContext: action.context,
          inspectorHistory: action.context ? history : [],
        },
      };
    }
    case "INSPECTOR_BACK": {
      const prev =
        state.viewState.inspectorHistory[state.viewState.inspectorHistory.length - 1] ?? null;
      return {
        ...state,
        viewState: {
          ...state.viewState,
          inspectorContext: prev,
          inspectorHistory: state.viewState.inspectorHistory.slice(0, -1),
        },
      };
    }
    case "ADD_NARRATIVE": {
      // Inject an initial world-building commit as the first timeline entry
      const n = {
        ...action.narrative,
        worldBuilds: { ...action.narrative.worldBuilds },
        branches: { ...action.narrative.branches },
      };
      const rootBranch = Object.values(n.branches).find(
        (b) => b.parentBranchId === null,
      );
      const allChars = Object.values(n.characters);
      const allLocs = Object.values(n.locations);
      const allThreads = Object.values(n.threads);

      // Only inject a world-build commit if the narrative doesn't already have one
      const hasExistingWorldBuild = Object.keys(n.worldBuilds).length > 0;
      const worldBuildId = nextId("WB", Object.keys(n.worldBuilds), 3);
      if (
        rootBranch &&
        !hasExistingWorldBuild &&
        (allChars.length > 0 || allLocs.length > 0 || allThreads.length > 0)
      ) {
        const parts: string[] = [];
        if (allChars.length > 0)
          parts.push(
            `${allChars.length} character${allChars.length > 1 ? "s" : ""} (${allChars.map((c) => c.name).join(", ")})`,
          );
        if (allLocs.length > 0)
          parts.push(
            `${allLocs.length} location${allLocs.length > 1 ? "s" : ""} (${allLocs.map((l) => l.name).join(", ")})`,
          );
        if (allThreads.length > 0)
          parts.push(
            `${allThreads.length} thread${allThreads.length > 1 ? "s" : ""}`,
          );
        if (n.relationships.length > 0)
          parts.push(
            `${n.relationships.length} relationship${n.relationships.length > 1 ? "s" : ""}`,
          );

        const allArtifacts = Object.values(n.artifacts ?? {});
        const wkNodeCount = Object.keys(n.systemGraph?.nodes ?? {}).length;
        if (allArtifacts.length > 0)
          parts.push(
            `${allArtifacts.length} artifact${allArtifacts.length > 1 ? "s" : ""}`,
          );
        if (wkNodeCount > 0)
          parts.push(
            `${wkNodeCount} knowledge node${wkNodeCount > 1 ? "s" : ""}`,
          );
        const worldBuild: WorldBuild = {
          kind: "world_build",
          id: worldBuildId,
          summary: `World created: ${parts.join(", ")}`,
          expansionManifest: {
            newCharacters: allChars,
            newLocations: allLocs,
            newThreads: allThreads,
            newArtifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
            systemDeltas: {
              addedNodes: Object.values(n.systemGraph?.nodes ?? {}).map(
                (node) => ({
                  id: node.id,
                  concept: node.concept,
                  type: node.type,
                }),
              ),
              addedEdges: (n.systemGraph?.edges ?? []).map((edge) => ({
                from: edge.from,
                to: edge.to,
                relation: edge.relation,
              })),
            },
            relationshipDeltas: n.relationships.map((r) => ({
              from: r.from,
              to: r.to,
              type: r.type,
              valenceDelta: r.valence,
            })),
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
        resolvedEntryKeys: newResolved,
        viewState: {
          ...defaultViewState,
          activeBranchId: newBranchId,
          currentSceneIndex: Math.max(0, newResolved.length - 1),
        },
      };
    }
    case "DELETE_NARRATIVE": {
      const isSeed = SEED_IDS.has(action.id);
      const isActive = state.activeNarrativeId === action.id;

      // Fire-and-forget async delete
      deletePersisted(action.id).catch((err) => {
        logError("Failed to delete narrative from storage", err, {
          source: "other",
          operation: "delete-narrative",
          details: { narrativeId: action.id },
        });
      });
      deleteApiLogs(action.id).catch((err) => {
        logError("Failed to delete API logs from storage", err, {
          source: "other",
          operation: "delete-api-logs",
          details: { narrativeId: action.id },
        });
      });
      // Delete associated assets (audio, embeddings, images)
      assetManager
        .init()
        .then(() => assetManager.deleteNarrativeAssets(action.id))
        .catch((err) => {
          logError("Failed to delete narrative assets", err, {
            source: "other",
            operation: "delete-narrative-assets",
            details: { narrativeId: action.id },
          });
        });

      if (isSeed) {
        // Reset seed to original bundled data instead of removing it
        const originalSeed = bundledNarratives.get(action.id);
        if (!originalSeed) return state;
        const resetEntry = narrativeToEntry(originalSeed);
        return {
          ...state,
          narratives: state.narratives.map((n) =>
            n.id === action.id ? resetEntry : n,
          ),
          activeNarrativeId: isActive ? null : state.activeNarrativeId,
          activeNarrative: isActive ? null : state.activeNarrative,
        };
      }

      return {
        ...state,
        narratives: state.narratives.filter((n) => n.id !== action.id),
        activeNarrativeId: isActive ? null : state.activeNarrativeId,
        activeNarrative: isActive ? null : state.activeNarrative,
      };
    }
    case "SELECT_KNOWLEDGE_ENTITY":
      return {
        ...state,
        viewState: {
          ...state.viewState,
          selectedKnowledgeEntity: action.entityId,
          selectedThreadLog: null,
        },
      };
    case "SELECT_THREAD_LOG":
      return {
        ...state,
        viewState: {
          ...state.viewState,
          selectedThreadLog: action.threadId,
          selectedKnowledgeEntity: null,
        },
      };
    case "SET_GRAPH_VIEW_MODE":
      return {
        ...state,
        graphViewMode: action.mode,
        viewState: {
          ...state.viewState,
          selectedThreadLog: null,
          selectedKnowledgeEntity: null,
        },
      };

    case "SET_SEARCH_QUERY":
      return {
        ...state,
        viewState: {
          ...state.viewState,
          currentSearchQuery: action.query,
          currentResultIndex: 0,
          searchFocusMode: true,
        },
      };

    case "SET_SEARCH_RESULT_INDEX":
      return {
        ...state,
        viewState: { ...state.viewState, currentResultIndex: action.index },
      };

    case "CLEAR_SEARCH":
      return {
        ...state,
        viewState: {
          ...state.viewState,
          currentSearchQuery: null,
          currentResultIndex: 0,
          searchFocusMode: false,
        },
      };

    case "TOGGLE_SEARCH_FOCUS":
      return {
        ...state,
        viewState: { ...state.viewState, searchFocusMode: !state.viewState.searchFocusMode },
      };

    case "SWITCH_BRANCH": {
      if (!state.activeNarrative) return state;
      const resolved = getResolvedKeys(state.activeNarrative, action.branchId);
      const derived = withDerivedEntities(state.activeNarrative, resolved);
      return {
        ...state,
        activeNarrative: derived,
        resolvedEntryKeys: resolved,
        viewState: {
          ...state.viewState,
          activeBranchId: action.branchId,
          currentSceneIndex: resolved.length - 1,
          inspectorContext:
            resolved.length > 0
              ? { type: "scene" as const, sceneId: resolved[resolved.length - 1] }
              : null,
          selectedKnowledgeEntity: null,
          selectedThreadLog: null,
        },
      };
    }

    // ── CRUD: Scenes ──────────────────────────────────────────────────────
    case "UPDATE_SCENE":
      return updateNarrative(state, (n) => {
        const scene = n.scenes[action.sceneId];
        if (!scene) return n;

        const updates = { ...action.updates };
        let updatedScene = { ...scene };
        const versionType = action.versionType ?? "generate";

        // Get current resolved version (from pointer or latest for this branch)
        const branch = state.viewState.activeBranchId
          ? n.branches[state.viewState.activeBranchId]
          : undefined;
        const currentProsePointer =
          branch?.versionPointers?.[scene.id]?.proseVersion;
        const currentPlanPointer =
          branch?.versionPointers?.[scene.id]?.planVersion;

        // Helper to compute next version number
        // Version hierarchy: generate (major) → rewrite (minor) → edit (sub-minor)
        // E.g., 1 → 1.1 → 1.1.1, 1.1.2 → 1.2 → 2 → 2.1 → 2.1.1
        // IMPORTANT: Version numbers are GLOBALLY unique across all branches.
        // Even if user is on V1.2 and V1.3 exists elsewhere, new rewrite creates V1.4
        const computeNextVersion = (
          allVersions: {
            version: string;
            branchId: string;
            versionType: string;
          }[],
          _branchId: string,
          type: "generate" | "rewrite" | "edit",
          currentVersion?: string, // The version currently being viewed/edited
        ): { version: string; parentVersion?: string } => {
          // Sort versions: highest first by major, then minor, then edit
          const sortVersions = (vList: typeof allVersions) => {
            return [...vList].sort((a, b) => {
              const aParts = a.version.split(".").map(Number);
              const bParts = b.version.split(".").map(Number);
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
            const parts = v.split(".").map(Number);
            return {
              major: parts[0] ?? 0,
              minor: parts[1] ?? 0,
              edit: parts[2] ?? 0,
            };
          };

          // Get the current version's parts (if specified)
          const current = currentVersion ? parseVersion(currentVersion) : null;

          if (type === "generate") {
            // Fresh generation: find highest major version GLOBALLY, increment
            let maxMajor = 0;
            for (const v of allVersions) {
              const major = parseInt(v.version.split(".")[0], 10);
              if (!isNaN(major) && major > maxMajor) maxMajor = major;
            }
            return {
              version: String(maxMajor + 1),
              parentVersion: currentVersion,
            };
          } else if (type === "rewrite") {
            // Rewrite: increment minor at the CURRENT major level, but check for existing higher minors
            if (allVersions.length === 0) {
              return { version: "1.1", parentVersion: undefined };
            }

            // Use current version's major, or latest if none specified
            const sorted = sortVersions(allVersions);
            const targetMajor =
              current?.major ?? parseVersion(sorted[0].version).major;

            // Find highest minor at this major level (across all branches)
            let maxMinor = 0;
            for (const v of allVersions) {
              const parts = parseVersion(v.version);
              if (parts.major === targetMajor && parts.minor > maxMinor) {
                maxMinor = parts.minor;
              }
            }

            return {
              version: `${targetMajor}.${maxMinor + 1}`,
              parentVersion: currentVersion,
            };
          } else {
            // Edit: increment sub-minor at the CURRENT major.minor level, check for existing higher edits
            if (allVersions.length === 0) {
              return { version: "1.0.1", parentVersion: undefined };
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
              if (
                parts.major === targetMajor &&
                parts.minor === targetMinor &&
                parts.edit > maxEdit
              ) {
                maxEdit = parts.edit;
              }
            }

            return {
              version: `${targetMajor}.${targetMinor}.${maxEdit + 1}`,
              parentVersion: currentVersion,
            };
          }
        };

        // Handle prose versioning — append to version array instead of overwriting
        let newProseVersion: string | undefined;
        if (updates.prose !== undefined && state.viewState.activeBranchId) {
          const { version, parentVersion } = computeNextVersion(
            scene.proseVersions ?? [],
            state.viewState.activeBranchId,
            versionType,
            currentProsePointer, // Use pointer if user pinned a specific version
          );
          const newVersion = {
            prose: updates.prose,
            beatProseMap: updates.beatProseMap,
            proseScore: updates.proseScore,
            branchId: state.viewState.activeBranchId,
            timestamp: Date.now(),
            version,
            versionType,
            parentVersion,
            sourcePlanVersion: action.sourcePlanVersion,
          };
          updatedScene.proseVersions = [
            ...(scene.proseVersions ?? []),
            newVersion,
          ];
          // Auto-update version pointer to point to the new version
          newProseVersion = version;
          // Remove from direct updates — no longer writing to legacy fields
          delete updates.prose;
          delete updates.beatProseMap;
          delete updates.proseScore;
        }

        // Handle beatProseMap attachment without prose change. Reverse-engineering
        // a plan from existing prose produces a new beat-prose alignment for the
        // ALREADY-WRITTEN prose. We should not fabricate a new prose version
        // (the text hasn't changed); instead, update the beatProseMap on the
        // currently-pointed prose version in place.
        if (
          updates.beatProseMap !== undefined &&
          updates.prose === undefined &&
          (updatedScene.proseVersions ?? scene.proseVersions ?? []).length > 0
        ) {
          const versions = updatedScene.proseVersions ?? scene.proseVersions ?? [];
          // Pick the target prose version: pointer first, then latest by timestamp.
          const pointer = state.viewState.activeBranchId
            ? n.branches[state.viewState.activeBranchId]?.versionPointers?.[scene.id]?.proseVersion
            : undefined;
          let targetIdx = pointer
            ? versions.findIndex(v => v.version === pointer)
            : -1;
          if (targetIdx < 0) {
            // Fallback: latest by timestamp.
            let latestIdx = 0;
            for (let i = 1; i < versions.length; i++) {
              if (versions[i].timestamp > versions[latestIdx].timestamp) latestIdx = i;
            }
            targetIdx = latestIdx;
          }
          updatedScene.proseVersions = versions.map((v, i) =>
            i === targetIdx ? { ...v, beatProseMap: updates.beatProseMap } : v,
          );
          delete updates.beatProseMap;
        }

        // Handle plan versioning — append to version array instead of overwriting
        let newPlanVersion: string | undefined;
        if (updates.plan !== undefined && state.viewState.activeBranchId) {
          const { version, parentVersion } = computeNextVersion(
            scene.planVersions ?? [],
            state.viewState.activeBranchId,
            versionType,
            currentPlanPointer, // Use pointer if user pinned a specific version
          );
          const newVersion = {
            plan: updates.plan,
            branchId: state.viewState.activeBranchId,
            timestamp: Date.now(),
            version,
            versionType,
            parentVersion,
          };
          updatedScene.planVersions = [
            ...(scene.planVersions ?? []),
            newVersion,
          ];
          // Auto-update version pointer to point to the new version
          newPlanVersion = version;
          delete updates.plan;
        }

        // Apply remaining updates (non-versioned fields like summary, events, deltas, etc.)
        updatedScene = { ...updatedScene, ...updates };

        // Update version pointers to point to newly created versions
        let updatedBranches = n.branches;
        if (state.viewState.activeBranchId && (newProseVersion || newPlanVersion)) {
          const currentBranch = n.branches[state.viewState.activeBranchId];
          if (currentBranch) {
            const currentPointers =
              currentBranch.versionPointers?.[action.sceneId] ?? {};
            const updatedPointers = {
              ...currentPointers,
              ...(newProseVersion ? { proseVersion: newProseVersion } : {}),
              ...(newPlanVersion ? { planVersion: newPlanVersion } : {}),
            };
            updatedBranches = {
              ...n.branches,
              [state.viewState.activeBranchId]: {
                ...currentBranch,
                versionPointers: {
                  ...currentBranch.versionPointers,
                  [action.sceneId]: updatedPointers,
                },
              },
            };
          }
        }

        return {
          ...n,
          scenes: { ...n.scenes, [action.sceneId]: updatedScene },
          branches: updatedBranches,
        };
      });

    case "DELETE_SCENE": {
      const newState = updateNarrative(state, (n) => {
        const { [action.sceneId]: _, ...restScenes } = n.scenes;
        const { [action.sceneId]: __, ...restWorldBuilds } = n.worldBuilds;
        const branch = n.branches[action.branchId];
        const updatedBranches = branch
          ? {
              ...n.branches,
              [action.branchId]: {
                ...branch,
                entryIds: branch.entryIds.filter((s) => s !== action.sceneId),
              },
            }
          : n.branches;
        const updatedArcs = Object.fromEntries(
          Object.entries(n.arcs).map(([id, arc]) => [
            id,
            {
              ...arc,
              sceneIds: arc.sceneIds.filter((s) => s !== action.sceneId),
            },
          ]),
        );
        return {
          ...n,
          scenes: restScenes,
          worldBuilds: restWorldBuilds,
          branches: updatedBranches,
          arcs: updatedArcs,
        };
      });
      if (newState.activeNarrative && newState.viewState.activeBranchId) {
        const resolved = getResolvedKeys(
          newState.activeNarrative,
          newState.viewState.activeBranchId,
        );
        return {
          ...newState,
          resolvedEntryKeys: resolved,
          viewState: {
            ...newState.viewState,
            currentSceneIndex: Math.min(
              newState.viewState.currentSceneIndex,
              resolved.length - 1,
            ),
          },
        };
      }
      return newState;
    }

    // ── CRUD: Branches ────────────────────────────────────────────────────
    case "CREATE_BRANCH": {
      const newState = updateNarrative(state, (n) => ({
        ...n,
        branches: { ...n.branches, [action.branch.id]: action.branch },
      }));
      if (newState.activeNarrative) {
        const resolved = getResolvedKeys(
          newState.activeNarrative,
          action.branch.id,
        );
        return {
          ...newState,
          resolvedEntryKeys: resolved,
          viewState: {
            ...newState.viewState,
            activeBranchId: action.branch.id,
            currentSceneIndex: resolved.length - 1,
          },
        };
      }
      return newState;
    }

    case "DELETE_BRANCH": {
      if (action.branchId === state.viewState.activeBranchId) return state;
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
      if (state.viewState.activeBranchId && toDelete.has(state.viewState.activeBranchId))
        return state;

      const result = updateNarrative(state, (n) => {
        const remaining = Object.fromEntries(
          Object.entries(n.branches).filter(([id]) => !toDelete.has(id)),
        );

        // Entries owned exclusively by deleted branches (not shared with survivors)
        const deletedEntries = new Set<string>();
        toDelete.forEach((bid) =>
          n.branches[bid]?.entryIds.forEach((eid) => deletedEntries.add(eid)),
        );
        const survivingEntries = new Set<string>();
        Object.values(remaining).forEach((b) =>
          b.entryIds.forEach((eid) => survivingEntries.add(eid)),
        );
        const entriesToRemove = new Set(
          [...deletedEntries].filter((eid) => !survivingEntries.has(eid)),
        );

        const scenes = Object.fromEntries(
          Object.entries(n.scenes).filter(([id]) => !entriesToRemove.has(id)),
        );
        const worldBuilds = Object.fromEntries(
          Object.entries(n.worldBuilds).filter(
            ([id]) => !entriesToRemove.has(id),
          ),
        );

        // Clean up arcs: remove deleted scene IDs, drop arcs that become empty
        const arcs = Object.fromEntries(
          Object.entries(n.arcs).flatMap(([id, arc]) => {
            const sceneIds = arc.sceneIds.filter(
              (sid) => !entriesToRemove.has(sid),
            );
            return sceneIds.length === 0 ? [] : [[id, { ...arc, sceneIds }]];
          }),
        );

        return { ...n, branches: remaining, scenes, worldBuilds, arcs };
      });

      if (result.activeNarrative && result.viewState.activeBranchId) {
        const resolved = getResolvedKeys(
          result.activeNarrative,
          result.viewState.activeBranchId,
        );
        const derived = withDerivedEntities(result.activeNarrative, resolved);
        return {
          ...result,
          activeNarrative: derived,
          resolvedEntryKeys: resolved,
        };
      }
      return result;
    }

    case "RENAME_BRANCH":
      return updateNarrative(state, (n) => {
        const branch = n.branches[action.branchId];
        if (!branch) return n;
        return {
          ...n,
          branches: {
            ...n.branches,
            [action.branchId]: { ...branch, name: action.name },
          },
        };
      });

    case "CLEAR_SCENE_PROSE_VERSION":
    case "CLEAR_SCENE_PLAN_VERSION": {
      const isProse = action.type === "CLEAR_SCENE_PROSE_VERSION";
      return updateNarrative(state, (n) => {
        const scene = n.scenes[action.sceneId];
        if (!scene) return n;
        const branch = n.branches[action.branchId];
        if (!branch) return n;

        // Find the version currently resolved for this branch — either the
        // pinned pointer or the natural resolution. That is the version the
        // user sees and wants to clear.
        const versions = isProse ? scene.proseVersions ?? [] : scene.planVersions ?? [];
        const pointerVersion = isProse
          ? branch.versionPointers?.[scene.id]?.proseVersion
          : branch.versionPointers?.[scene.id]?.planVersion;
        const resolvedVersion = (() => {
          if (pointerVersion && versions.some(v => v.version === pointerVersion)) {
            return pointerVersion;
          }
          if (isProse) {
            const prose = resolveProseForBranch(scene, action.branchId, n.branches);
            const match = prose.prose !== undefined
              ? (scene.proseVersions ?? []).slice().sort((a, b) => b.timestamp - a.timestamp)
                  .find(v => v.prose === prose.prose)
              : undefined;
            return match?.version;
          } else {
            const plan = resolvePlanForBranch(scene, action.branchId, n.branches);
            const match = plan
              ? (scene.planVersions ?? []).slice().sort((a, b) => b.timestamp - a.timestamp)
                  .find(v => v.plan === plan)
              : undefined;
            return match?.version;
          }
        })();
        if (!resolvedVersion) return n;

        // Remove the resolved version from the scene's version array.
        const updatedVersions = versions.filter(v => v.version !== resolvedVersion);
        const updatedScene = isProse
          ? { ...scene, proseVersions: updatedVersions as typeof scene.proseVersions }
          : { ...scene, planVersions: updatedVersions as typeof scene.planVersions };

        // Clear the pointer if it was pinned to the removed version.
        const scenePointers = branch.versionPointers?.[scene.id];
        let updatedBranches = n.branches;
        if (scenePointers) {
          const pointerKey = isProse ? "proseVersion" : "planVersion";
          if (scenePointers[pointerKey] === resolvedVersion) {
            const { [pointerKey]: _removed, ...restScenePointers } = scenePointers;
            const restHasPointers = Object.keys(restScenePointers).length > 0;
            const { [scene.id]: _removedScene, ...otherScenePointers } = branch.versionPointers ?? {};
            const nextScenePointers = restHasPointers
              ? { ...otherScenePointers, [scene.id]: restScenePointers }
              : otherScenePointers;
            const nextPointers = Object.keys(nextScenePointers).length > 0 ? nextScenePointers : undefined;
            updatedBranches = {
              ...n.branches,
              [action.branchId]: { ...branch, versionPointers: nextPointers },
            };
          }
        }

        return {
          ...n,
          scenes: { ...n.scenes, [action.sceneId]: updatedScene },
          branches: updatedBranches,
        };
      });
    }

    case "SET_VERSION_POINTER":
      return updateNarrative(state, (n) => {
        const branch = n.branches[action.branchId];
        if (!branch) return n;

        const existingPointers = branch.versionPointers ?? {};
        const scenePointers = existingPointers[action.sceneId] ?? {};

        // Update or clear the pointer
        const updatedScenePointers =
          action.pointerType === "prose"
            ? { ...scenePointers, proseVersion: action.version }
            : { ...scenePointers, planVersion: action.version };

        // Clean up undefined values
        if (updatedScenePointers.proseVersion === undefined)
          delete updatedScenePointers.proseVersion;
        if (updatedScenePointers.planVersion === undefined)
          delete updatedScenePointers.planVersion;

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
          versionPointers:
            Object.keys(updatedPointers).length > 0
              ? updatedPointers
              : undefined,
        };

        return {
          ...n,
          branches: { ...n.branches, [action.branchId]: updatedBranch },
        };
      });

    case "REMOVE_BRANCH_ENTRY": {
      // Remove an entry from a branch's entryIds without deleting the scene itself.
      // Used when the scene is referenced by other branches.
      const newState = updateNarrative(state, (n) => {
        const branch = n.branches[action.branchId];
        if (!branch) return n;
        return {
          ...n,
          branches: {
            ...n.branches,
            [action.branchId]: {
              ...branch,
              entryIds: branch.entryIds.filter((id) => id !== action.entryId),
            },
          },
        };
      });
      if (newState.activeNarrative && newState.viewState.activeBranchId) {
        const resolved = getResolvedKeys(
          newState.activeNarrative,
          newState.viewState.activeBranchId,
        );
        const derived = withDerivedEntities(newState.activeNarrative, resolved);
        return {
          ...newState,
          activeNarrative: derived,
          resolvedEntryKeys: resolved,
        };
      }
      return newState;
    }

    case "SET_STRUCTURE_REVIEW":
      return updateNarrative(state, (n) => ({
        ...n,
        structureReviews: {
          ...n.structureReviews,
          [action.branchId]: action.evaluation,
        },
      }));

    case "SET_PROSE_EVALUATION":
      return updateNarrative(state, (n) => ({
        ...n,
        proseEvaluations: {
          ...n.proseEvaluations,
          [action.branchId]: action.evaluation,
        },
      }));

    case "SET_PLAN_EVALUATION":
      return updateNarrative(state, (n) => ({
        ...n,
        planEvaluations: {
          ...n.planEvaluations,
          [action.branchId]: action.evaluation,
        },
      }));

    case "RECONSTRUCT_BRANCH": {
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
    case "BULK_ADD_SCENES": {
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
          updatedArcs[action.arc.id] = {
            ...existing,
            sceneIds: [...existing.sceneIds, ...deduped],
          };
        }
        const branch = n.branches[action.branchId];
        const existingEntrySet = branch
          ? new Set(branch.entryIds)
          : new Set<string>();
        const dedupedEntries = newSceneIds.filter(
          (id) => !existingEntrySet.has(id),
        );

        const updatedBranch = branch
          ? { ...branch, entryIds: [...branch.entryIds, ...dedupedEntries] }
          : null;

        const updatedBranches = updatedBranch
          ? { ...n.branches, [action.branchId]: updatedBranch }
          : n.branches;
        return {
          ...n,
          scenes: newScenes,
          arcs: updatedArcs,
          branches: updatedBranches,
        };
      });
      if (newState.activeNarrative && newState.viewState.activeBranchId) {
        const resolved = getResolvedKeys(
          newState.activeNarrative,
          newState.viewState.activeBranchId,
        );
        const derived = withDerivedEntities(newState.activeNarrative, resolved);
        return {
          ...newState,
          activeNarrative: derived,
          resolvedEntryKeys: resolved,
        };
      }
      return newState;
    }

    // ── Expand World: merge new elements + create world build ─────
    case "EXPAND_WORLD": {
      const worldBuildId = action.worldBuildId;

      // Build summary from expansion contents
      const charNames = action.characters.map((c) => c.name);
      const locNames = action.locations.map((l) => l.name);
      const threadDescs = action.threads.map((t) => t.description);
      const parts: string[] = [];
      const wkNodeCount = action.systemDeltas?.addedNodes?.length ?? 0;
      const wkEdgeCount = action.systemDeltas?.addedEdges?.length ?? 0;
      if (charNames.length > 0)
        parts.push(
          `${charNames.length} character${charNames.length > 1 ? "s" : ""} (${charNames.join(", ")})`,
        );
      if (locNames.length > 0)
        parts.push(
          `${locNames.length} location${locNames.length > 1 ? "s" : ""} (${locNames.join(", ")})`,
        );
      if (threadDescs.length > 0)
        parts.push(
          `${threadDescs.length} thread${threadDescs.length > 1 ? "s" : ""}`,
        );
      const artifactNames = action.artifacts.map((a) => a.name);
      const relDeltaCount = action.relationshipDeltas?.length ?? 0;
      if (relDeltaCount > 0)
        parts.push(
          `${relDeltaCount} relationship${relDeltaCount > 1 ? "s" : ""}`,
        );
      if (artifactNames.length > 0)
        parts.push(
          `${artifactNames.length} artifact${artifactNames.length > 1 ? "s" : ""} (${artifactNames.join(", ")})`,
        );
      if (wkNodeCount > 0)
        parts.push(
          `${wkNodeCount} knowledge node${wkNodeCount > 1 ? "s" : ""} (${action.systemDeltas!.addedNodes.map((n) => n.concept).join(", ")})`,
        );
      if (wkEdgeCount > 0)
        parts.push(
          `${wkEdgeCount} knowledge edge${wkEdgeCount > 1 ? "s" : ""}`,
        );
      const worldBuildSummary =
        parts.length > 0
          ? `World expanded: added ${parts.join(", ")}`
          : "World expansion (no new elements)";

      // Build manifest systemGraph: explicit deltas + auto-generated nodes for threads/locations
      const autoNodes: SystemDelta["addedNodes"] = [];
      let autoCounter = 0;
      for (const t of action.threads) {
        const covered = (action.systemDeltas?.addedNodes ?? []).some(
          (nd) => nd.concept === t.description,
        );
        if (!covered)
          autoNodes.push({
            id: `${worldBuildId}-T${++autoCounter}`,
            concept: t.description,
            type: "concept" as const,
          });
      }
      for (const l of action.locations) {
        const covered = (action.systemDeltas?.addedNodes ?? []).some(
          (nd) => nd.concept === l.name,
        );
        if (!covered)
          autoNodes.push({
            id: `${worldBuildId}-L${++autoCounter}`,
            concept: l.name,
            type: "concept" as const,
          });
      }
      const manifestWK: SystemDelta = {
        addedNodes: [
          ...(action.systemDeltas?.addedNodes ?? []),
          ...autoNodes,
        ],
        addedEdges: action.systemDeltas?.addedEdges ?? [],
      };

      const worldBuild: WorldBuild = {
        kind: "world_build",
        id: worldBuildId,
        summary: worldBuildSummary,
        expansionManifest: {
          newCharacters: action.characters,
          newLocations: action.locations,
          newArtifacts: action.artifacts,
          newThreads: action.threads.map((t) => ({
            ...t,
            openedAt: worldBuildId,
          })),
          threadDeltas: action.threadDeltas,
          worldDeltas: action.worldDeltas,
          systemDeltas: manifestWK,
          relationshipDeltas: action.relationshipDeltas,
          ownershipDeltas: action.ownershipDeltas,
          tieDeltas: action.tieDeltas,
        },
        reasoningGraph: action.reasoningGraph,
      };

      const newState = updateNarrative(state, (n) => {
        // Idempotent: skip if this world build was already applied
        if (n.worldBuilds[worldBuildId]) return n;

        const branch = n.branches[action.branchId];
        const updatedBranches = branch
          ? {
              ...n.branches,
              [action.branchId]: {
                ...branch,
                entryIds: [...branch.entryIds, worldBuildId],
              },
            }
          : n.branches;

        return {
          ...n,
          worldBuilds: { ...n.worldBuilds, [worldBuildId]: worldBuild },
          branches: updatedBranches,
        };
      });

      if (newState.activeNarrative && newState.viewState.activeBranchId) {
        const resolved = getResolvedKeys(
          newState.activeNarrative,
          newState.viewState.activeBranchId,
        );
        const derived = withDerivedEntities(newState.activeNarrative, resolved);
        return {
          ...newState,
          activeNarrative: derived,
          resolvedEntryKeys: resolved,
        };
      }
      return newState;
    }

    // ── Auto mode ──────────────────────────────────────────────────────────
    case "SET_AUTO_CONFIG":
      return { ...state, autoConfig: action.config };

    case "START_AUTO_RUN":
      return {
        ...state,
        viewState: {
          ...state.viewState,
          autoRunState: {
            isRunning: true,
            isPaused: false,
            currentCycle: 0,
            consecutiveFailures: 0,
            statusMessage: "Starting...",
            totalScenesGenerated: 0,
            totalWorldExpansions: 0,
            startingSceneCount: state.resolvedEntryKeys.length,
            startingArcCount: state.activeNarrative
              ? Object.keys(state.activeNarrative.arcs).length
              : 0,
            log: [],
          },
        },
      };

    case "PAUSE_AUTO_RUN":
      return state.viewState.autoRunState
        ? {
            ...state,
            viewState: {
              ...state.viewState,
              autoRunState: {
                ...state.viewState.autoRunState,
                isPaused: true,
                isRunning: false,
              },
            },
          }
        : state;

    case "RESUME_AUTO_RUN":
      return state.viewState.autoRunState
        ? {
            ...state,
            viewState: {
              ...state.viewState,
              autoRunState: {
                ...state.viewState.autoRunState,
                isPaused: false,
                isRunning: true,
              },
            },
          }
        : state;

    case "STOP_AUTO_RUN":
      return { ...state, viewState: { ...state.viewState, autoRunState: null } };

    case "SET_AUTO_STATUS":
      return state.viewState.autoRunState
        ? {
            ...state,
            viewState: {
              ...state.viewState,
              autoRunState: {
                ...state.viewState.autoRunState,
                statusMessage: action.message,
              },
            },
          }
        : state;

    case "LOG_AUTO_CYCLE":
      return state.viewState.autoRunState
        ? {
            ...state,
            viewState: {
              ...state.viewState,
              autoRunState: {
                ...state.viewState.autoRunState,
                currentCycle: state.viewState.autoRunState.currentCycle + 1,
                consecutiveFailures: action.entry.error
                  ? state.viewState.autoRunState.consecutiveFailures + 1
                  : 0,
                totalScenesGenerated:
                  state.viewState.autoRunState.totalScenesGenerated +
                  action.entry.scenesGenerated,
                totalWorldExpansions:
                  state.viewState.autoRunState.totalWorldExpansions +
                  (action.entry.worldExpanded ? 1 : 0),
                log: [...state.viewState.autoRunState.log, action.entry],
              },
            },
          }
        : state;

    case "SET_COVER_IMAGE": {
      // Update the narrative entry in the list
      const updatedNarratives = state.narratives.map((e) =>
        e.id === action.narrativeId
          ? { ...e, coverImageUrl: action.imageUrl }
          : e,
      );
      // If this is the active narrative, update it too
      if (
        state.activeNarrative &&
        state.activeNarrative.id === action.narrativeId
      ) {
        const updatedActive = {
          ...state.activeNarrative,
          coverImageUrl: action.imageUrl,
        };
        return {
          ...state,
          narratives: updatedNarratives,
          activeNarrative: updatedActive,
        };
      }
      // For non-active narratives, persist directly
      loadNarrative(action.narrativeId)
        .then((stored) => {
          if (stored)
            persistNarrative({ ...stored, coverImageUrl: action.imageUrl });
        })
        .catch((err) => {
          logError("Failed to update cover image in storage", err, {
            source: "other",
            operation: "update-cover-image",
            details: { narrativeId: action.narrativeId },
          });
        });
      return { ...state, narratives: updatedNarratives };
    }

    case "UPDATE_NARRATIVE_META": {
      const metaUpdates: Partial<{ title: string; description: string }> = {};
      if (action.title !== undefined) metaUpdates.title = action.title;
      if (action.description !== undefined)
        metaUpdates.description = action.description;
      const updatedNarratives = state.narratives.map((e) =>
        e.id === action.narrativeId ? { ...e, ...metaUpdates } : e,
      );
      if (
        state.activeNarrative &&
        state.activeNarrative.id === action.narrativeId
      ) {
        const updatedActive = { ...state.activeNarrative, ...metaUpdates };
        return {
          ...state,
          narratives: updatedNarratives,
          activeNarrative: updatedActive,
        };
      }
      loadNarrative(action.narrativeId)
        .then((stored) => {
          if (stored) persistNarrative({ ...stored, ...metaUpdates });
        })
        .catch((err) => {
          logError("Failed to update narrative metadata in storage", err, {
            source: "other",
            operation: "update-narrative-meta",
            details: { narrativeId: action.narrativeId },
          });
        });
      return { ...state, narratives: updatedNarratives };
    }

    case "SET_SCENE_IMAGE":
      return updateNarrative(state, (n) => {
        const scene = n.scenes[action.sceneId];
        if (!scene) return n;
        return {
          ...n,
          scenes: {
            ...n.scenes,
            [action.sceneId]: { ...scene, imageUrl: action.imageUrl },
          },
        };
      });

    case "SET_SCENE_AUDIO":
      return updateNarrative(state, (n) => {
        const scene = n.scenes[action.sceneId];
        if (!scene) return n;
        return {
          ...n,
          scenes: {
            ...n.scenes,
            [action.sceneId]: { ...scene, audioUrl: action.audioUrl },
          },
        };
      });

    case "CLEAR_SCENE_AUDIO":
      return updateNarrative(state, (n) => {
        const scene = n.scenes[action.sceneId];
        if (!scene) return n;
        const { audioUrl: _, ...rest } = scene;
        return { ...n, scenes: { ...n.scenes, [action.sceneId]: rest } };
      });

    case "SET_CHARACTER_IMAGE": {
      const afterUpdate = updateNarrative(state, (n) => {
        const worldBuildEntry = Object.values(n.worldBuilds).find((wb) =>
          wb.expansionManifest.newCharacters.some(
            (c) => c.id === action.characterId,
          ),
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
                newCharacters: worldBuildEntry.expansionManifest.newCharacters.map(
                  (c) =>
                    c.id === action.characterId
                      ? { ...c, imageUrl: action.imageUrl }
                      : c,
                ),
              },
            },
          },
        };
      });
      if (!afterUpdate.activeNarrative) return afterUpdate;
      const derived = withDerivedEntities(
        afterUpdate.activeNarrative,
        afterUpdate.resolvedEntryKeys,
      );
      return { ...afterUpdate, activeNarrative: derived };
    }

    case "SET_LOCATION_IMAGE": {
      const afterUpdate = updateNarrative(state, (n) => {
        const worldBuildEntry = Object.values(n.worldBuilds).find((wb) =>
          wb.expansionManifest.newLocations.some(
            (l) => l.id === action.locationId,
          ),
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
                newLocations: worldBuildEntry.expansionManifest.newLocations.map(
                  (l) =>
                    l.id === action.locationId
                      ? { ...l, imageUrl: action.imageUrl }
                      : l,
                ),
              },
            },
          },
        };
      });
      if (!afterUpdate.activeNarrative) return afterUpdate;
      const derived = withDerivedEntities(
        afterUpdate.activeNarrative,
        afterUpdate.resolvedEntryKeys,
      );
      return { ...afterUpdate, activeNarrative: derived };
    }

    case "SET_ARTIFACT_IMAGE": {
      const afterUpdate = updateNarrative(state, (n) => {
        const worldBuildEntry = Object.values(n.worldBuilds).find((wb) =>
          (wb.expansionManifest.newArtifacts ?? []).some(
            (a) => a.id === action.artifactId,
          ),
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
                newArtifacts: (
                  worldBuildEntry.expansionManifest.newArtifacts ?? []
                ).map((a) =>
                  a.id === action.artifactId
                    ? { ...a, imageUrl: action.imageUrl }
                    : a,
                ),
              },
            },
          },
        };
      });
      if (!afterUpdate.activeNarrative) return afterUpdate;
      const derived = withDerivedEntities(
        afterUpdate.activeNarrative,
        afterUpdate.resolvedEntryKeys,
      );
      return { ...afterUpdate, activeNarrative: derived };
    }

    case "SET_IMAGE_STYLE":
      return updateNarrative(state, (n) => ({
        ...n,
        imageStyle: action.style,
      }));

    case "SET_STORY_SETTINGS":
      return updateNarrative(state, (n) => ({
        ...n,
        storySettings: action.settings,
      }));

    case "SET_PROSE_PROFILE":
      return updateNarrative(state, (n) => ({
        ...n,
        proseProfile: action.profile,
      }));

    case "SET_PATTERNS":
      return updateNarrative(state, (n) => ({
        ...n,
        patterns: action.patterns,
      }));

    case "SET_ANTI_PATTERNS":
      return updateNarrative(state, (n) => ({
        ...n,
        antiPatterns: action.antiPatterns,
      }));

    case "SET_GENRE":
      return updateNarrative(state, (n) => ({
        ...n,
        genre: action.genre,
      }));

    case "SET_SUBGENRE":
      return updateNarrative(state, (n) => ({
        ...n,
        subgenre: action.subgenre,
      }));

    case "SET_DETECTED_PATTERNS":
      return updateNarrative(state, (n) => ({
        ...n,
        genre: action.genre,
        subgenre: action.subgenre,
        patterns: action.patterns,
        antiPatterns: action.antiPatterns,
      }));

    // ── Analysis ──────────────────────────────────────────────────────────
    case "ADD_ANALYSIS_JOB":
      return { ...state, analysisJobs: [...state.analysisJobs, action.job] };

    case "UPDATE_ANALYSIS_JOB":
      return {
        ...state,
        analysisJobs: state.analysisJobs.map((j) =>
          j.id === action.id
            ? { ...j, ...action.updates, updatedAt: Date.now() }
            : j,
        ),
      };

    case "DELETE_ANALYSIS_JOB":
      return {
        ...state,
        analysisJobs: state.analysisJobs.filter((j) => j.id !== action.id),
      };

    case "HYDRATE_ANALYSIS_JOBS": {
      // Merge: keep any in-memory jobs created before hydration completed (race condition guard)
      const hydratedIds = new Set(action.jobs.map((j) => j.id));
      const inMemoryOnly = state.analysisJobs.filter(
        (j) => !hydratedIds.has(j.id),
      );
      return { ...state, analysisJobs: [...action.jobs, ...inMemoryOnly] };
    }

    // ── Chat threads ──────────────────────────────────────────────────────
    case "CREATE_CHAT_THREAD": {
      const withThread = updateNarrative(state, (n) => ({
        ...n,
        chatThreads: {
          ...(n.chatThreads ?? {}),
          [action.thread.id]: action.thread,
        },
      }));
      return { ...withThread, viewState: { ...withThread.viewState, activeChatThreadId: action.thread.id } };
    }

    case "DELETE_CHAT_THREAD": {
      const withoutThread = updateNarrative(state, (n) => {
        const { [action.threadId]: _, ...rest } = n.chatThreads ?? {};
        return { ...n, chatThreads: rest };
      });
      let nextActive = state.viewState.activeChatThreadId;
      if (state.viewState.activeChatThreadId === action.threadId) {
        const remaining = Object.values(
          withoutThread.activeNarrative?.chatThreads ?? {},
        );
        remaining.sort((a, b) => b.updatedAt - a.updatedAt);
        nextActive = remaining[0]?.id ?? null;
      }
      return { ...withoutThread, viewState: { ...withoutThread.viewState, activeChatThreadId: nextActive } };
    }

    case "RENAME_CHAT_THREAD":
      return updateNarrative(state, (n) => {
        const thread = n.chatThreads?.[action.threadId];
        if (!thread) return n;
        return {
          ...n,
          chatThreads: {
            ...(n.chatThreads ?? {}),
            [action.threadId]: { ...thread, name: action.name },
          },
        };
      });

    case "SET_ACTIVE_CHAT_THREAD":
      return { ...state, viewState: { ...state.viewState, activeChatThreadId: action.threadId } };

    case "UPSERT_CHAT_THREAD":
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

    case "CREATE_NOTE": {
      const withNote = updateNarrative(state, (n) => ({
        ...n,
        notes: { ...(n.notes ?? {}), [action.note.id]: action.note },
      }));
      return { ...withNote, viewState: { ...withNote.viewState, activeNoteId: action.note.id } };
    }

    case "DELETE_NOTE": {
      const withoutNote = updateNarrative(state, (n) => {
        const { [action.noteId]: _, ...rest } = n.notes ?? {};
        return { ...n, notes: rest };
      });
      let nextActiveNote = state.viewState.activeNoteId;
      if (state.viewState.activeNoteId === action.noteId) {
        const remaining = Object.values(
          withoutNote.activeNarrative?.notes ?? {},
        );
        remaining.sort((a, b) => b.updatedAt - a.updatedAt);
        nextActiveNote = remaining[0]?.id ?? null;
      }
      return { ...withoutNote, viewState: { ...withoutNote.viewState, activeNoteId: nextActiveNote } };
    }

    case "UPDATE_NOTE":
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
              ...(action.content !== undefined
                ? { content: action.content }
                : {}),
              updatedAt: Date.now(),
            },
          },
        };
      });

    case "SET_ACTIVE_NOTE":
      return { ...state, viewState: { ...state.viewState, activeNoteId: action.noteId } };

    // ── Coordination Plan ─────────────────────────────────────────────────
    case "SET_COORDINATION_PLAN":
      return updateNarrative(state, (n) => {
        const branch = n.branches[action.branchId];
        if (!branch) return n;
        return {
          ...n,
          branches: {
            ...n.branches,
            [action.branchId]: { ...branch, coordinationPlan: action.plan },
          },
        };
      });

    case "CLEAR_COORDINATION_PLAN":
      return updateNarrative(state, (n) => {
        const branch = n.branches[action.branchId];
        if (!branch) return n;
        return {
          ...n,
          branches: {
            ...n.branches,
            [action.branchId]: { ...branch, coordinationPlan: undefined },
          },
        };
      });

    case "ADVANCE_COORDINATION_PLAN":
      return updateNarrative(state, (n) => {
        const branch = n.branches[action.branchId];
        if (!branch?.coordinationPlan) return n;
        const { plan } = branch.coordinationPlan;
        // Arc indices are 1-based, but currentArc starts at 0 when plan is created
        // Treat 0 as 1 (we just completed arc 1)
        const executedArc = plan.currentArc === 0 ? 1 : plan.currentArc;
        const nextArc = executedArc + 1;

        // Mark executed arc as completed
        const completedArcs = [...plan.completedArcs];
        if (!completedArcs.includes(executedArc)) {
          completedArcs.push(executedArc);
        }

        // Advance to next arc or mark plan as complete
        const isComplete = nextArc > plan.arcCount;

        return {
          ...n,
          branches: {
            ...n.branches,
            [action.branchId]: {
              ...branch,
              coordinationPlan: {
                ...branch.coordinationPlan,
                plan: {
                  ...plan,
                  currentArc: isComplete ? plan.arcCount : nextArc,
                  completedArcs,
                },
              },
            },
          },
        };
      });

    case "RESET_COORDINATION_PLAN":
      // Rewind the plan pointer to arc 1 (fresh), clearing completed arcs.
      // Keeps the plan structure intact — only progress is reset.
      return updateNarrative(state, (n) => {
        const branch = n.branches[action.branchId];
        if (!branch?.coordinationPlan) return n;
        const { plan } = branch.coordinationPlan;
        return {
          ...n,
          branches: {
            ...n.branches,
            [action.branchId]: {
              ...branch,
              coordinationPlan: {
                ...branch.coordinationPlan,
                plan: {
                  ...plan,
                  currentArc: 0,
                  completedArcs: [],
                },
              },
            },
          },
        };
      });

    case "SET_COORDINATION_PLAN_ARC":
      // Manually set the plan pointer to any arc. Treats arcs before the
      // pointer as completed and arcs at/after as pending. `arcIndex` is
      // 1-based; pass 0 to rewind to "not started" (equivalent to reset).
      return updateNarrative(state, (n) => {
        const branch = n.branches[action.branchId];
        if (!branch?.coordinationPlan) return n;
        const { plan } = branch.coordinationPlan;
        const clampedArc = Math.max(0, Math.min(plan.arcCount, action.arcIndex));
        // Every arc strictly before the pointer is considered completed.
        const completedArcs: number[] = [];
        for (let i = 1; i < clampedArc; i++) completedArcs.push(i);
        return {
          ...n,
          branches: {
            ...n.branches,
            [action.branchId]: {
              ...branch,
              coordinationPlan: {
                ...branch.coordinationPlan,
                plan: {
                  ...plan,
                  currentArc: clampedArc,
                  completedArcs,
                },
              },
            },
          },
        };
      });

    case "SET_ARC_REASONING_GRAPH":
      return updateNarrative(state, (n) => {
        const arc = n.arcs[action.arcId];
        if (!arc) return n;
        return {
          ...n,
          arcs: {
            ...n.arcs,
            [action.arcId]: {
              ...arc,
              reasoningGraph: action.reasoningGraph,
            },
          },
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

  // Hydrate persisted narratives from IndexedDB on mount
  useEffect(() => {
    async function hydrate() {
      // Migrate from localStorage if needed (one-time)
      await migrateFromLocalStorage();

      let persisted: NarrativeState[] = [];
      try {
        persisted = await loadNarratives();
      } catch (err) {
        logError("Failed to load narratives during hydration", err, {
          source: "other",
          operation: "hydrate-narratives",
        });
      }
      const persistedById = new Map(persisted.map((n) => [n.id, n]));

      // User entries (from IndexedDB) load immediately
      const userEntries = persisted
        .filter(
          (n) =>
            !SEED_IDS.has(n.id) &&
            !PLAYGROUND_IDS.has(n.id) &&
            !ANALYSIS_IDS.has(n.id),
        )
        .map(narrativeToEntry);

      // Initialize with user entries immediately so UI is responsive
      dispatch({ type: "HYDRATE_NARRATIVES", entries: userEntries });

      // Helper to import assets from a ZIP in the background (non-blocking, parallel)
      async function importAssetsInBackground(
        zip: import("jszip"),
        file: string,
      ) {
        const tasks: Promise<void>[] = [];

        // Import embeddings (in parallel)
        const embeddingsFolder = zip.folder("embeddings");
        if (embeddingsFolder) {
          const embFiles = Object.values(embeddingsFolder.files).filter(
            (f) => !f.dir && f.name.endsWith(".bin"),
          );
          console.log(
            `[loadManifest] Importing ${embFiles.length} embeddings from ${file} in background`,
          );
          tasks.push(
            Promise.all(
              embFiles.map(async (embFile) => {
                const fileName = embFile.name.split("/").pop()!;
                const embId = fileName.replace(".bin", "");
                try {
                  const buffer = await embFile.async("arraybuffer");
                  const float32Array = new Float32Array(buffer);
                  const vector = Array.from(float32Array);
                  await assetManager.storeEmbedding(
                    vector,
                    "text-embedding-3-small",
                    embId,
                  );
                } catch (err) {
                  console.warn(`Failed to import embedding ${embId}:`, err);
                }
              }),
            ).then(() => {
              console.log(`[loadManifest] Embeddings imported from ${file}`);
            }),
          );
        }

        // Import audio (in parallel)
        const audioFolder = zip.folder("audio");
        if (audioFolder) {
          const audioFiles = Object.values(audioFolder.files).filter(
            (f) => !f.dir && f.name.startsWith("audio/"),
          );
          console.log(
            `[loadManifest] Importing ${audioFiles.length} audio files from ${file} in background`,
          );
          tasks.push(
            Promise.all(
              audioFiles.map(async (audioFile) => {
                const fileName = audioFile.name.split("/").pop()!;
                const [audioId] = fileName.split(".");
                try {
                  const blob = await audioFile.async("blob");
                  await assetManager.storeAudio(blob, blob.type, audioId);
                } catch (err) {
                  console.warn(`Failed to import audio ${audioId}:`, err);
                }
              }),
            ).then(() => {
              console.log(`[loadManifest] Audio imported from ${file}`);
            }),
          );
        }

        // Import images (in parallel)
        const imagesFolder = zip.folder("images");
        if (imagesFolder) {
          const imageFiles = Object.values(imagesFolder.files).filter(
            (f) => !f.dir && f.name.startsWith("images/"),
          );
          console.log(
            `[loadManifest] Importing ${imageFiles.length} images from ${file} in background`,
          );
          tasks.push(
            Promise.all(
              imageFiles.map(async (imageFile) => {
                const fileName = imageFile.name.split("/").pop()!;
                const [imgId] = fileName.split(".");
                try {
                  const blob = await imageFile.async("blob");
                  await assetManager.storeImage(blob, blob.type, imgId);
                } catch (err) {
                  console.warn(`Failed to import image ${imgId}:`, err);
                }
              }),
            ).then(() => {
              console.log(`[loadManifest] Images imported from ${file}`);
            }),
          );
        }

        // Run all asset types in parallel
        await Promise.all(tasks);
        console.log(
          `[loadManifest] Finished importing all assets from ${file}`,
        );
      }

      // Import assets from an extracted directory in the background
      async function importDirAssetsInBackground(
        basePath: string,
        entry: string,
      ) {
        // Load embeddings manifest
        try {
          const embManifestRes = await fetch(
            `/${basePath}/${entry}embeddings/manifest.json`,
          );
          if (embManifestRes.ok) {
            const embFiles: string[] = await embManifestRes.json();
            console.log(
              `[loadManifest] Importing ${embFiles.length} embeddings from ${entry} in background`,
            );
            // Import in batches of 50 to avoid flooding the network
            for (let i = 0; i < embFiles.length; i += 50) {
              const batch = embFiles.slice(i, i + 50);
              await Promise.all(
                batch.map(async (fileName) => {
                  const embId = fileName.replace(".bin", "");
                  try {
                    const res = await fetch(
                      `/${basePath}/${entry}embeddings/${fileName}`,
                    );
                    if (!res.ok) return;
                    const buffer = await res.arrayBuffer();
                    const float32Array = new Float32Array(buffer);
                    const vector = Array.from(float32Array);
                    await assetManager.storeEmbedding(
                      vector,
                      "text-embedding-3-small",
                      embId,
                    );
                  } catch (err) {
                    console.warn(`Failed to import embedding ${embId}:`, err);
                  }
                }),
              );
            }
            console.log(`[loadManifest] Embeddings imported from ${entry}`);
          }
        } catch (err) {
          console.warn(
            `[loadManifest] Failed to import dir embeddings for ${entry}:`,
            err,
          );
        }
      }

      // Load a single bundled file and dispatch entry immediately when ready
      // Returns the narrative for preset initialization, asset import runs in background
      async function loadBundledFile(
        dir: string,
        file: string,
        idSet: Set<string>,
      ): Promise<NarrativeState | null> {
        try {
          // Directory entry — trailing slash means fetch narrative.json from within
          const isDir = file.endsWith("/");

          console.log(
            `[loadManifest] Loading ${dir}/${file} (${isDir ? "directory" : "file"})`,
          );

          const fetchUrl = isDir
            ? `/${dir}/${file}narrative.json`
            : `/${dir}/${file}`;
          const r = await fetch(fetchUrl);
          if (!r.ok) {
            logError(
              `Failed to fetch bundled narrative ${fetchUrl}`,
              `HTTP ${r.status} ${r.statusText}`,
              {
                source: "other",
                operation: "load-manifest",
                details: { directory: dir, file, status: r.status, url: fetchUrl },
              },
            );
            return null;
          }

          const arrayBuffer = await r.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          const isZip =
            !isDir &&
            bytes.length >= 2 &&
            bytes[0] === 0x50 &&
            bytes[1] === 0x4b;
          console.log(
            `[loadManifest] ${file} is ${isDir ? "DIR" : isZip ? "ZIP" : "JSON"} format (size: ${bytes.length} bytes)`,
          );

          let narrative: NarrativeState;

          if (isZip) {
            const JSZip = (await import("jszip")).default;
            const zip = await JSZip.loadAsync(arrayBuffer);

            const narrativeFile = zip.file("narrative.json");
            if (!narrativeFile) {
              console.error(
                `[loadManifest] Invalid .inktide ZIP in ${dir}/${file}: missing narrative.json`,
              );
              logWarning(
                `Invalid .inktide ZIP in ${dir}/${file}`,
                "missing narrative.json",
                {
                  source: "other",
                  operation: "load-manifest",
                },
              );
              return null;
            }

            const narrativeText = await narrativeFile.async("text");
            narrative = JSON.parse(narrativeText) as NarrativeState;

            // Check if already in IndexedDB
            const saved = persistedById.get(narrative.id);
            if (saved) {
              console.log(
                `[loadManifest] Using saved version of ${narrative.title} from IndexedDB`,
              );
              SEED_IDS.add(narrative.id);
              idSet.add(narrative.id);
              dispatch({
                type: "ADD_NARRATIVE_ENTRY",
                entry: narrativeToEntry(saved),
              });
              return narrative;
            }

            // Dispatch entry immediately (before asset import)
            console.log(
              `[loadManifest] Adding bundled narrative: ${narrative.title}`,
            );
            bundledNarratives.set(narrative.id, narrative);
            SEED_IDS.add(narrative.id);
            idSet.add(narrative.id);
            dispatch({
              type: "ADD_NARRATIVE_ENTRY",
              entry: narrativeToEntry(narrative),
            });

            // Import assets in background (non-blocking)
            importAssetsInBackground(zip, file).catch((err) => {
              logWarning(
                `Background asset import failed for ${file}`,
                err,
                {
                  source: "asset",
                  operation: "import-assets",
                  details: { directory: dir, file },
                },
              );
            });
          } else {
            // Plain JSON format (both file and directory entries reach here)
            const text = new TextDecoder().decode(arrayBuffer);
            narrative = JSON.parse(text) as NarrativeState;

            const saved = persistedById.get(narrative.id);
            if (saved) {
              console.log(
                `[loadManifest] Using saved version of ${narrative.title} from IndexedDB`,
              );
              SEED_IDS.add(narrative.id);
              idSet.add(narrative.id);
              dispatch({
                type: "ADD_NARRATIVE_ENTRY",
                entry: narrativeToEntry(saved),
              });
              return narrative;
            }

            console.log(
              `[loadManifest] Adding bundled narrative: ${narrative.title}`,
            );
            bundledNarratives.set(narrative.id, narrative);
            SEED_IDS.add(narrative.id);
            idSet.add(narrative.id);
            dispatch({
              type: "ADD_NARRATIVE_ENTRY",
              entry: narrativeToEntry(narrative),
            });

            // Import directory assets in background
            if (isDir) {
              importDirAssetsInBackground(dir, file).catch((err) => {
                logWarning(
                  `Background dir asset import failed for ${file}`,
                  err,
                  {
                    source: "asset",
                    operation: "import-assets",
                    details: { directory: dir, file },
                  },
                );
              });
            }
          }

          console.log(
            `[loadManifest] Successfully loaded narrative: ${narrative.title} (${narrative.id})`,
          );
          return narrative;
        } catch (err) {
          logError(
            `Failed to load bundled narrative ${dir}/${file}`,
            err,
            {
              source: "other",
              operation: "load-manifest",
              details: { directory: dir, file },
            },
          );
          return null;
        }
      }

      // Load manifest and process files progressively
      async function loadManifestProgressive(
        dir: string,
        idSet: Set<string>,
      ): Promise<NarrativeState[]> {
        try {
          console.log(
            `[loadManifest] Fetching manifest from /${dir}/manifest.json`,
          );
          const res = await fetch(`/${dir}/manifest.json`);
          if (!res.ok) {
            console.error(
              `[loadManifest] Failed to fetch manifest for ${dir}:`,
              res.status,
            );
            logWarning(
              `Failed to fetch manifest for ${dir}`,
              `HTTP ${res.status}`,
              {
                source: "other",
                operation: "load-manifest",
                details: { directory: dir, status: res.status },
              },
            );
            return [];
          }
          const files: string[] = await res.json();
          console.log(
            `[loadManifest] Found ${files.length} files in ${dir}:`,
            files,
          );

          // Load all files in parallel, each dispatches its entry as soon as ready
          const results = await Promise.all(
            files.map((file) => loadBundledFile(dir, file, idSet)),
          );

          const loaded = results.filter((n): n is NarrativeState => n !== null);
          const missing = files.filter((_, i) => results[i] === null);
          console.log(
            `[loadManifest] Loaded ${loaded.length}/${files.length} narratives from ${dir}`,
          );
          if (missing.length > 0) {
            logError(
              `${missing.length}/${files.length} bundled narratives in "${dir}" failed to load`,
              `Missing: ${missing.join(", ")}`,
              {
                source: "other",
                operation: "load-manifest",
                details: {
                  directory: dir,
                  missingCount: missing.length,
                  totalCount: files.length,
                  missing: missing.join(", "),
                },
              },
            );
          }
          return loaded;
        } catch (err) {
          logError(`Failed to load manifest for ${dir}`, err, {
            source: "other",
            operation: "load-manifest",
            details: { directory: dir },
          });
          return [];
        }
      }

      // Load playgrounds first (complete before works)
      await loadManifestProgressive("playgrounds", PLAYGROUND_IDS);

      // Then load works progressively
      const worksNarratives = await loadManifestProgressive(
        "works",
        ANALYSIS_IDS,
      );

      // Initialize Markov chain presets from analysed works
      const worksForPresets: {
        key: string;
        name: string;
        narrative: NarrativeState;
      }[] = [];
      for (const narrative of worksNarratives) {
        if (ANALYSIS_IDS.has(narrative.id)) {
          const key = narrative.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/(^_|_$)/g, "");
          worksForPresets.push({ key, name: narrative.title, narrative });
        }
      }
      if (worksForPresets.length > 0) {
        initMatrixPresets(worksForPresets);
        initBeatProfilePresets(worksForPresets);
        initMechanismProfilePresets(worksForPresets);
      }

      // Restore last active narrative
      const savedActiveId = await loadActiveNarrativeId();
      if (savedActiveId) {
        dispatch({ type: "SET_ACTIVE_NARRATIVE", id: savedActiveId });
      }
    }
    hydrate().catch((err) => {
      logError("Hydration failed — narratives may not appear", err, {
        source: "other",
        operation: "hydrate-narratives",
      });
    });
  }, []);

  // Load narrative from IndexedDB when activeNarrativeId changes
  useEffect(() => {
    const id = state.activeNarrativeId;
    if (!id) {
      prevActiveIdRef.current = null;
      return;
    }
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
        dispatch({ type: "LOADED_NARRATIVE", narrative, savedBranchId });
      }
    }
    load().catch((err) => {
      logError("Failed to load narrative from storage", err, {
        source: "other",
        operation: "load-narrative",
        details: { narrativeId: id },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [state.activeNarrativeId]);

  // Persist active narrative to IndexedDB whenever it changes
  useEffect(() => {
    const narrative = state.activeNarrative;
    if (!narrative) return;
    // Skip if reference hasn't changed (avoids redundant writes)
    if (narrative === prevNarrativeRef.current) return;
    prevNarrativeRef.current = narrative;

    persistNarrative(narrative).catch((err) => {
      logError("Failed to persist narrative to storage", err, {
        source: "other",
        operation: "persist-narrative",
        details: { narrativeId: narrative.id },
      });
    });
  }, [state.activeNarrative]);

  // Persist active narrative ID whenever it changes
  useEffect(() => {
    saveActiveNarrativeId(state.activeNarrativeId).catch((err) => {
      logError("Failed to persist active narrative ID to storage", err, {
        source: "other",
        operation: "persist-active-narrative-id",
        details: { narrativeId: state.activeNarrativeId },
      });
    });
  }, [state.activeNarrativeId]);

  // Persist active branch ID whenever it changes (skip null to avoid race with SET_ACTIVE_NARRATIVE)
  useEffect(() => {
    if (state.viewState.activeBranchId === null) return;
    saveActiveBranchId(state.viewState.activeBranchId).catch((err) => {
      logError("Failed to persist active branch ID to storage", err, {
        source: "other",
        operation: "persist-active-branch-id",
        details: { branchId: state.viewState.activeBranchId },
      });
    });
  }, [state.viewState.activeBranchId]);

  // Hydrate analysis jobs from IndexedDB on mount
  useEffect(() => {
    loadAnalysisJobs().then((jobs) => {
      if (jobs.length > 0) {
        // Mark any previously-running jobs as paused (they were interrupted)
        const restored = jobs.map((j) =>
          j.status === "running"
            ? { ...j, status: "paused" as const, updatedAt: Date.now() }
            : j,
        );
        dispatch({ type: "HYDRATE_ANALYSIS_JOBS", jobs: restored });
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
        logError("Failed to delete analysis API logs", err, {
          source: "analysis",
          operation: "delete-analysis-api-logs",
          details: { analysisId: job.id },
        });
      });
    }

    saveAnalysisJobs(state.analysisJobs).catch((err) => {
      logError("Failed to persist analysis jobs to storage", err, {
        source: "analysis",
        operation: "persist-analysis-jobs",
        details: { jobCount: state.analysisJobs.length },
      });
    });
  }, [state.analysisJobs]);

  // Load search state from IndexedDB when active narrative changes
  useEffect(() => {
    const narrativeId = state.activeNarrativeId;
    if (!narrativeId) return;

    loadSearchState(narrativeId)
      .then((query) => {
        if (query) {
          dispatch({ type: "SET_SEARCH_QUERY", query });
        }
      })
      .catch(() => {
        // Silently fail for search state loading
      });
  }, [state.activeNarrativeId]);

  // Persist search state whenever it changes
  const prevSearchQueryRef = useRef(state.viewState.currentSearchQuery);
  useEffect(() => {
    const narrativeId = state.activeNarrativeId;
    if (!narrativeId) return;
    if (state.viewState.currentSearchQuery === prevSearchQueryRef.current) return;
    prevSearchQueryRef.current = state.viewState.currentSearchQuery;
    saveSearchState(narrativeId, state.viewState.currentSearchQuery).catch(() => {
      // Silently fail for search state persistence
    });
  }, [state.viewState.currentSearchQuery, state.activeNarrativeId]);

  // Generate prose embeddings for manual prose edits
  const proseEmbeddingQueueRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const narrative = state.activeNarrative;
    const branchId = state.viewState.activeBranchId;
    if (!narrative || !branchId) return;

    // Check all scenes for prose that needs embedding
    const scenesToEmbed: Array<{
      sceneId: string;
      prose: string;
      version: string;
    }> = [];

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
            const { generateEmbeddings } = await import("@/lib/embeddings");
            const { assetManager } = await import("@/lib/asset-manager");
            const embeddings = await generateEmbeddings([prose], narrative.id);
            const proseEmbedding = await assetManager.storeEmbedding(
              embeddings[0],
              "text-embedding-3-small",
            );

            // Update scene with embedding (non-versioned update)
            dispatch({
              type: "UPDATE_SCENE",
              sceneId,
              updates: { proseEmbedding },
            });

            // Remove from queue
            proseEmbeddingQueueRef.current.delete(queueKey);
          } catch (err) {
            // Log error but don't fail - embedding is non-critical
            logError("Failed to generate prose embedding", err, {
              source: "prose-generation",
              operation: "embed-prose-manual",
              details: { sceneId, narrativeId: narrative.id },
            });
            proseEmbeddingQueueRef.current.delete(queueKey);
          }
        })();
      }
    }
  }, [state.activeNarrative, state.viewState.activeBranchId]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          dispatch({ type: "PREV_SCENE" });
          break;
        case "ArrowRight":
          e.preventDefault();
          dispatch({ type: "NEXT_SCENE" });
          break;
        case " ":
          e.preventDefault();
          dispatch({ type: "TOGGLE_PLAY" });
          break;
        case "Escape":
          dispatch({ type: "SET_INSPECTOR", context: null });
          dispatch({ type: "SELECT_KNOWLEDGE_ENTITY", entityId: null });
          dispatch({ type: "SELECT_THREAD_LOG", threadId: null });
          break;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
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
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
