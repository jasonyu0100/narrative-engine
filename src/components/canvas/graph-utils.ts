import * as d3 from 'd3';
import type {
  Character,
  Location,
  Artifact,
  RelationshipEdge,
  CharacterRole,
  Arc,
  Scene,
  WorldBuild,
} from '@/types/narrative';

// ── Graph node / link types ─────────────────────────────────────────────────

export type NodeKind = 'character' | 'location' | 'knowledge' | 'artifact';

export interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  kind: NodeKind;
  label: string;
  /** Only for character nodes */
  role?: CharacterRole;
  /** Thread count badge */
  threadCount?: number;
  /** Only for knowledge nodes */
  continuityType?: string;
  /** Parent character id for knowledge nodes */
  parentCharacterId?: string;
  /** Usage count for overview mode */
  usageCount?: number;
  /** Image URL for character portrait or location photo */
  imageUrl?: string;
  /** AI-generated visual description */
  imagePrompt?: string;
}

export interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  id: string;
  linkKind: 'relationship' | 'spatial' | 'knowledge' | 'character-location' | 'ownership';
  label?: string;
  valence?: number;
  /** For bidirectional pairs: labels for each direction (sourceId → label) */
  directedLabels?: Record<string, string>;
}

// ── World Knowledge graph types ─────────────────────────────────────────────

export type WKNode = d3.SimulationNodeDatum & { id: string; concept: string; type: string; degree: number };
export type WKLink = d3.SimulationLinkDatum<WKNode> & { relation: string };

// ── Helper: compute connected components (groups) ──────────────────────────

export function computeGroups<N extends d3.SimulationNodeDatum & { id: string }, L extends d3.SimulationLinkDatum<N>>(
  nodes: N[],
  links: L[],
): N[][] {
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.id, new Set());
  for (const l of links) {
    const s = typeof l.source === 'string' ? l.source : (l.source as N).id;
    const t = typeof l.target === 'string' ? l.target : (l.target as N).id;
    adj.get(s)?.add(t);
    adj.get(t)?.add(s);
  }

  const visited = new Set<string>();
  const groups: N[][] = [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    const component: N[] = [];
    const stack = [node.id];
    while (stack.length) {
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const n = nodeMap.get(id);
      if (n) component.push(n);
      for (const neighbor of adj.get(id) ?? []) {
        if (!visited.has(neighbor)) stack.push(neighbor);
      }
    }
    groups.push(component);
  }

  // Sort descending by size
  groups.sort((a, b) => b.length - a.length);
  return groups;
}

// ── Constants ───────────────────────────────────────────────────────────────

export const ROLE_RADIUS: Record<CharacterRole, number> = {
  anchor: 22,
  recurring: 18,
  transient: 14,
};

export const ROLE_FILL: Record<CharacterRole, string> = {
  anchor: '#E8E8E8',
  recurring: '#888888',
  transient: '#555555',
};

export const LOCATION_SIZE = 24;
export const LOCATION_RX = 6;
export const LOCATION_FILL = '#333333';

/** Interpolate from cool (blue) to hot (red) matching force graph colors */
export function heatColor(t: number): string {
  // knowledge (blue) → change (green) → payoff (red)
  const stops = [
    [59, 130, 246],   // #3B82F6 knowledge blue
    [34, 197, 94],    // #22C55E change green
    [239, 68, 68],    // #EF4444 payoff red
  ];
  const idx = t * (stops.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, stops.length - 1);
  const f = idx - lo;
  const r = Math.round(stops[lo][0] + (stops[hi][0] - stops[lo][0]) * f);
  const g = Math.round(stops[lo][1] + (stops[hi][1] - stops[lo][1]) * f);
  const b = Math.round(stops[lo][2] + (stops[hi][2] - stops[lo][2]) * f);
  return `rgb(${r},${g},${b})`;
}

export const CONTINUITY_FILL: Record<string, string> = {
  knows: '#FFFFFF',
  believes: '#FFFFFF',
  secret: '#F59E0B',
  goal: '#3B82F6',
};

export const KNOWLEDGE_OPACITY: Record<string, number> = {
  knows: 1,
  believes: 0.5,
  secret: 1,
  goal: 1,
};

export const DEFAULT_CONTINUITY_FILL = '#FFFFFF';
export const DEFAULT_KNOWLEDGE_OPACITY = 0.7;

// ── World Knowledge type colors ─────────────────────────────────────────────

export const WK_TYPE_COLORS: Record<string, string> = {
  law: '#FBBF24',      // vivid gold
  system: '#38BDF8',   // vivid sky blue
  concept: '#A78BFA',  // vivid violet
  tension: '#FB7185',  // vivid rose
};

export const WK_TYPE_GLOW: Record<string, string> = {
  law: '0 0 12px #FBBF2480, 0 0 4px #FBBF2440',
  system: '0 0 12px #38BDF880, 0 0 4px #38BDF840',
  concept: '0 0 12px #A78BFA80, 0 0 4px #A78BFA40',
  tension: '0 0 12px #FB718580, 0 0 4px #FB718540',
};

// ── Helper: build graph data from narrative state ───────────────────────────

/** Compute current character positions by replaying arc initial + scene deltas up to sceneIndex */
export function computeCharacterPositions(
  arc: Arc,
  scenes: Record<string, Scene>,
  currentSceneIndex: number,
  resolvedEntryKeys: string[],
): Record<string, string> {
  const positions = { ...arc.initialCharacterLocations };
  const arcScenes = arc.sceneIds.map((sid) => scenes[sid]).filter(Boolean);
  // Find the offset of this arc's first scene within the resolved scene order
  const arcStartGlobal = resolvedEntryKeys.indexOf(arc.sceneIds[0]);

  for (let i = 0; i < arcScenes.length; i++) {
    const globalIdx = arcStartGlobal + i;
    if (globalIdx < 0 || globalIdx > currentSceneIndex) break;
    const scene = arcScenes[i];
    if (scene.characterMovements) {
      for (const [charId, mv] of Object.entries(scene.characterMovements)) {
        positions[charId] = mv.locationId;
      }
    }
  }
  return positions;
}

export function buildGraphData(
  characters: Record<string, Character>,
  locations: Record<string, Location>,
  relationships: RelationshipEdge[],
  characterPositions: Record<string, string>,
  artifacts?: Record<string, Artifact>,
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  // Character nodes
  for (const char of Object.values(characters)) {
    nodes.push({
      id: char.id,
      kind: 'character',
      label: char.name,
      role: char.role,
      threadCount: char.threadIds.length,
      imageUrl: char.imageUrl,
      imagePrompt: char.imagePrompt,
    });
  }

  // Location nodes
  for (const loc of Object.values(locations)) {
    nodes.push({
      id: loc.id,
      kind: 'location',
      label: loc.name,
      threadCount: loc.threadIds.length,
      imageUrl: loc.imageUrl,
      imagePrompt: loc.imagePrompt,
    });
  }

  // Relationship edges
  for (const rel of relationships) {
    links.push({
      id: `rel-${rel.from}-${rel.to}-${rel.type}`,
      source: rel.from,
      target: rel.to,
      linkKind: 'relationship',
      label: rel.type,
      valence: rel.valence,
    });
  }

  // Spatial edges (child -> parent location)
  for (const loc of Object.values(locations)) {
    if (loc.parentId && locations[loc.parentId]) {
      links.push({
        id: `spatial-${loc.id}-${loc.parentId}`,
        source: loc.id,
        target: loc.parentId,
        linkKind: 'spatial',
      });
    }
  }

  // Character → location position edges
  const locationIds = new Set(Object.keys(locations));
  for (const [charId, locId] of Object.entries(characterPositions)) {
    if (characters[charId] && locationIds.has(locId)) {
      links.push({
        id: `charloc-${charId}-${locId}`,
        source: charId,
        target: locId,
        linkKind: 'character-location',
      });
    }
  }

  // Artifact nodes + ownership edges
  for (const art of Object.values(artifacts ?? {})) {
    nodes.push({
      id: art.id,
      kind: 'artifact',
      label: art.name,
      imageUrl: art.imageUrl,
      imagePrompt: art.imagePrompt,
    });
    if (characters[art.parentId] || locations[art.parentId]) {
      links.push({
        id: `ownership-${art.id}-${art.parentId}`,
        source: art.id,
        target: art.parentId,
        linkKind: 'ownership',
        label: 'owned by',
      });
    }
  }

  return { nodes, links };
}

// ── Overview graph: aggregated usage across all scenes up to currentSceneIndex ──

export function buildOverviewGraphData(
  characters: Record<string, Character>,
  locations: Record<string, Location>,
  relationships: RelationshipEdge[],
  scenes: Record<string, Scene>,
  worldBuilds: Record<string, WorldBuild>,
  resolvedEntryKeys: string[],
  currentSceneIndex: number,
  artifacts?: Record<string, Artifact>,
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  // Count usage up to current scene index
  const charUsage: Record<string, number> = {};
  const locUsage: Record<string, number> = {};

  for (let i = 0; i <= currentSceneIndex && i < resolvedEntryKeys.length; i++) {
    const key = resolvedEntryKeys[i];
    const wb = worldBuilds[key];
    if (wb) {
      // World builds introduce elements — count manifest IDs so they appear in overview
      for (const c of wb.expansionManifest.characters) {
        charUsage[c.id] = (charUsage[c.id] ?? 0) + 1;
      }
      for (const l of wb.expansionManifest.locations) {
        locUsage[l.id] = (locUsage[l.id] ?? 0) + 1;
      }
    } else {
      const scene = scenes[key];
      if (!scene) continue;
      for (const pid of scene.participantIds) {
        charUsage[pid] = (charUsage[pid] ?? 0) + 1;
      }
      if (scene.locationId) {
        locUsage[scene.locationId] = (locUsage[scene.locationId] ?? 0) + 1;
      }
    }
  }

  // Only include entities that appear at least once
  const activeCharIds = new Set(Object.keys(charUsage));
  const activeLocIds = new Set(Object.keys(locUsage));

  for (const char of Object.values(characters)) {
    if (!activeCharIds.has(char.id)) continue;
    nodes.push({
      id: char.id,
      kind: 'character',
      label: char.name,
      role: char.role,
      threadCount: char.threadIds.length,
      usageCount: charUsage[char.id],
      imageUrl: char.imageUrl,
      imagePrompt: char.imagePrompt,
    });
  }

  for (const loc of Object.values(locations)) {
    if (!activeLocIds.has(loc.id)) continue;
    nodes.push({
      id: loc.id,
      kind: 'location',
      label: loc.name,
      threadCount: loc.threadIds.length,
      usageCount: locUsage[loc.id],
      imageUrl: loc.imageUrl,
      imagePrompt: loc.imagePrompt,
    });
  }

  // Relationships between active characters
  for (const rel of relationships) {
    if (activeCharIds.has(rel.from) && activeCharIds.has(rel.to)) {
      links.push({
        id: `rel-${rel.from}-${rel.to}-${rel.type}`,
        source: rel.from,
        target: rel.to,
        linkKind: 'relationship',
        label: rel.type,
        valence: rel.valence,
      });
    }
  }

  // Spatial edges for active locations
  for (const loc of Object.values(locations)) {
    if (activeLocIds.has(loc.id) && loc.parentId && activeLocIds.has(loc.parentId)) {
      links.push({
        id: `spatial-${loc.id}-${loc.parentId}`,
        source: loc.id,
        target: loc.parentId,
        linkKind: 'spatial',
      });
    }
  }

  // Artifact nodes + ownership edges
  for (const art of Object.values(artifacts ?? {})) {
    const ownerActive = activeCharIds.has(art.parentId) || activeLocIds.has(art.parentId);
    if (!ownerActive) continue;
    nodes.push({
      id: art.id,
      kind: 'artifact',
      label: art.name,
      imageUrl: art.imageUrl,
      imagePrompt: art.imagePrompt,
    });
    links.push({
      id: `ownership-${art.id}-${art.parentId}`,
      source: art.id,
      target: art.parentId,
      linkKind: 'ownership',
      label: 'owned by',
    });
  }

  return { nodes, links };
}
