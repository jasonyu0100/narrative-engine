'use client';

import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import * as d3 from 'd3';
import { useStore } from '@/lib/store';
import type {
  Character,
  Location,
  RelationshipEdge,
  CharacterRole,
  Arc,
  Scene,
  WorldBuildCommit,
} from '@/types/narrative';

// ── Graph node / link types ─────────────────────────────────────────────────

type NodeKind = 'character' | 'location' | 'knowledge';

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  kind: NodeKind;
  label: string;
  /** Only for character nodes */
  role?: CharacterRole;
  /** Thread count badge */
  threadCount?: number;
  /** Only for knowledge nodes */
  knowledgeType?: string;
  /** Parent character id for knowledge nodes */
  parentCharacterId?: string;
  /** Usage count for overview mode */
  usageCount?: number;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  id: string;
  linkKind: 'relationship' | 'spatial' | 'knowledge' | 'character-location';
  label?: string;
  valence?: number;
  knowledgeEdgeType?: string;
  /** For bidirectional pairs: labels for each direction (sourceId → label) */
  directedLabels?: Record<string, string>;
}

// ── Constants ───────────────────────────────────────────────────────────────

const ROLE_RADIUS: Record<CharacterRole, number> = {
  anchor: 22,
  recurring: 18,
  transient: 14,
};

const ROLE_FILL: Record<CharacterRole, string> = {
  anchor: '#E8E8E8',
  recurring: '#888888',
  transient: '#555555',
};

const LOCATION_SIZE = 24;
const LOCATION_RX = 6;
const LOCATION_FILL = '#333333';

const KNOWLEDGE_FILL: Record<string, string> = {
  knows: '#FFFFFF',
  believes: '#FFFFFF',
  secret: '#F59E0B',
  goal: '#3B82F6',
};

const KNOWLEDGE_OPACITY: Record<string, number> = {
  knows: 1,
  believes: 0.5,
  secret: 1,
  goal: 1,
};

const DEFAULT_KNOWLEDGE_FILL = '#FFFFFF';
const DEFAULT_KNOWLEDGE_OPACITY = 0.7;

// ── Helper: build graph data from narrative state ───────────────────────────

/** Compute current character positions by replaying arc initial + scene deltas up to sceneIndex */
function computeCharacterPositions(
  arc: Arc,
  scenes: Record<string, Scene>,
  currentSceneIndex: number,
  resolvedSceneKeys: string[],
): Record<string, string> {
  const positions = { ...arc.initialCharacterLocations };
  const arcScenes = arc.sceneIds.map((sid) => scenes[sid]).filter(Boolean);
  // Find the offset of this arc's first scene within the resolved scene order
  const arcStartGlobal = resolvedSceneKeys.indexOf(arc.sceneIds[0]);

  for (let i = 0; i < arcScenes.length; i++) {
    const globalIdx = arcStartGlobal + i;
    if (globalIdx < 0 || globalIdx > currentSceneIndex) break;
    const scene = arcScenes[i];
    if (scene.characterMovements) {
      for (const [charId, locId] of Object.entries(scene.characterMovements)) {
        positions[charId] = locId;
      }
    }
  }
  return positions;
}

function buildGraphData(
  characters: Record<string, Character>,
  locations: Record<string, Location>,
  relationships: RelationshipEdge[],
  characterPositions: Record<string, string>,
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
    });
  }

  // Location nodes
  for (const loc of Object.values(locations)) {
    nodes.push({
      id: loc.id,
      kind: 'location',
      label: loc.name,
      threadCount: loc.threadIds.length,
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

  return { nodes, links };
}

// ── Overview graph: aggregated usage across all scenes up to currentSceneIndex ──

function buildOverviewGraphData(
  characters: Record<string, Character>,
  locations: Record<string, Location>,
  relationships: RelationshipEdge[],
  scenes: Record<string, Scene>,
  worldBuilds: Record<string, WorldBuildCommit>,
  resolvedSceneKeys: string[],
  currentSceneIndex: number,
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  // Count usage up to current scene index
  const charUsage: Record<string, number> = {};
  const locUsage: Record<string, number> = {};

  for (let i = 0; i <= currentSceneIndex && i < resolvedSceneKeys.length; i++) {
    const key = resolvedSceneKeys[i];
    const wb = worldBuilds[key];
    if (wb) {
      // World builds introduce elements — count manifest IDs so they appear in overview
      for (const cid of wb.expansionManifest.characterIds) {
        charUsage[cid] = (charUsage[cid] ?? 0) + 1;
      }
      for (const lid of wb.expansionManifest.locationIds) {
        locUsage[lid] = (locUsage[lid] ?? 0) + 1;
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

  return { nodes, links };
}

// ── Fullscreen button ────────────────────────────────────────────────────────

function FullscreenButton() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      title={isFullscreen ? 'Exit full screen' : 'Full screen'}
      className="absolute bottom-4 right-4 z-10 w-9 h-9 flex items-center justify-center glass-pill text-text-dim hover:text-text-primary transition-colors"
    >
      {isFullscreen ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3v3a2 2 0 0 1-2 2H3" />
          <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
          <path d="M3 16h3a2 2 0 0 1 2 2v3" />
          <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3H5a2 2 0 0 0-2 2v3" />
          <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
          <path d="M3 16v3a2 2 0 0 0 2 2h3" />
          <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
        </svg>
      )}
    </button>
  );
}

// ── Component ───────────────────────────────────────────────────────────────

export default function WorldGraph() {
  const { state, dispatch } = useStore();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
  const gRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const handleCharacterClickRef = useRef<(id: string) => void>(() => {});
  const handleLocationClickRef = useRef<(id: string) => void>(() => {});

  const [showEdgeLabels, setShowEdgeLabels] = useState(false);

  const narrative = state.activeNarrative;
  const inspectorContext = state.inspectorContext;
  const selectedKnowledgeEntity = state.selectedKnowledgeEntity;
  const graphViewMode = state.graphViewMode;

  const resolvedSceneKeys = state.resolvedSceneKeys;

  // Derive active arc ID — this is what triggers a full re-render
  const activeArcId = useMemo(() => {
    if (!narrative) return null;
    const currentKey = resolvedSceneKeys[state.currentSceneIndex];
    if (!currentKey) return null;
    return Object.values(narrative.arcs).find((a) => a.sceneIds.includes(currentKey))?.id ?? null;
  }, [narrative, state.currentSceneIndex, resolvedSceneKeys]);

  // Determine which node is selected for highlight
  const selectedNodeId = useMemo(() => {
    if (!inspectorContext) return null;
    switch (inspectorContext.type) {
      case 'character':
        return inspectorContext.characterId;
      case 'location':
        return inspectorContext.locationId;
      default:
        return null;
    }
  }, [inspectorContext]);

  const handleCharacterClick = useCallback(
    (characterId: string) => {
      dispatch({
        type: 'SELECT_KNOWLEDGE_ENTITY',
        entityId: selectedKnowledgeEntity === characterId ? null : characterId,
      });
      dispatch({
        type: 'SET_INSPECTOR',
        context: { type: 'character', characterId },
      });
    },
    [dispatch, selectedKnowledgeEntity],
  );
  handleCharacterClickRef.current = handleCharacterClick;

  const handleLocationClick = useCallback(
    (locationId: string) => {
      dispatch({
        type: 'SELECT_KNOWLEDGE_ENTITY',
        entityId: selectedKnowledgeEntity === locationId ? null : locationId,
      });
      dispatch({
        type: 'SET_INSPECTOR',
        context: { type: 'location', locationId },
      });
    },
    [dispatch, selectedKnowledgeEntity],
  );
  handleLocationClickRef.current = handleLocationClick;


  // Track the current world build ID (or null) — triggers full rebuild when navigating between world builds
  const currentWorldBuildId = useMemo(() => {
    if (!narrative) return null;
    const key = resolvedSceneKeys[state.currentSceneIndex];
    return key && narrative.worldBuilds[key] ? key : null;
  }, [narrative, resolvedSceneKeys, state.currentSceneIndex]);

  // ── Full rebuild: only on arc change or knowledge entity selection ────
  useEffect(() => {
    if (!svgRef.current || !narrative) return;

    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth || 800;
    const height = svgRef.current.clientHeight || 600;

    // Clear previous
    svg.selectAll('*').remove();

    let nodes: GraphNode[];
    let links: GraphLink[];

    if (graphViewMode === 'overview') {
      // Overview mode: all characters/locations sized by usage
      const result = buildOverviewGraphData(
        narrative.characters,
        narrative.locations,
        narrative.relationships,
        narrative.scenes,
        narrative.worldBuilds,
        resolvedSceneKeys,
        resolvedSceneKeys.length - 1,
      );
      nodes = result.nodes;
      links = result.links;
    } else {
      // Check if current scene is a world expansion
      const currentKey = resolvedSceneKeys[state.currentSceneIndex];
      const currentWorldBuild = currentKey ? narrative.worldBuilds[currentKey] : null;

      if (currentWorldBuild) {
        // Expansion mode: show only elements from this expansion
        const manifest = currentWorldBuild.expansionManifest;
        const expandedCharIds = new Set(manifest.characterIds);
        const expandedLocIds = new Set(manifest.locationIds);

        const filteredChars = Object.fromEntries(
          Object.entries(narrative.characters).filter(([id]) => expandedCharIds.has(id)),
        );
        const filteredLocs = Object.fromEntries(
          Object.entries(narrative.locations).filter(([id]) => expandedLocIds.has(id)),
        );
        const filteredRels = narrative.relationships.filter(
          (r) => expandedCharIds.has(r.from) && expandedCharIds.has(r.to),
        );

        const result = buildGraphData(
          filteredChars,
          filteredLocs,
          filteredRels,
          {},
        );
        nodes = result.nodes;
        links = result.links;
      } else {
        // Scene mode: scoped to active arc
        const activeArc = activeArcId
          ? narrative.arcs[activeArcId]
          : undefined;

        let filteredCharacters: Record<string, Character>;
        let filteredLocations: Record<string, Location>;
        let filteredRelationships: RelationshipEdge[];

        if (activeArc) {
          const activeCharIds = new Set(activeArc.activeCharacterIds);
          const activeLocIds = new Set(activeArc.locationIds);

          filteredCharacters = Object.fromEntries(
            Object.entries(narrative.characters).filter(([id]) => activeCharIds.has(id)),
          );
          filteredLocations = Object.fromEntries(
            Object.entries(narrative.locations).filter(([id]) => activeLocIds.has(id)),
          );
          filteredRelationships = narrative.relationships.filter(
            (r) => activeCharIds.has(r.from) && activeCharIds.has(r.to),
          );

        } else {
          filteredCharacters = narrative.characters;
          filteredLocations = narrative.locations;
          filteredRelationships = narrative.relationships;
        }

        const characterPositions = activeArc
          ? computeCharacterPositions(activeArc, narrative.scenes, state.currentSceneIndex, resolvedSceneKeys)
          : {};

        const result = buildGraphData(
          filteredCharacters,
          filteredLocations,
          filteredRelationships,
          characterPositions,
        );
        nodes = result.nodes;
        links = result.links;
      }
    }

    // Store nodes ref for intra-arc updates
    nodesRef.current = nodes;

    // Validate links
    const nodeIds = new Set(nodes.map((n) => n.id));
    const validLinks = links.filter((l) => {
      const srcId = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
      const tgtId = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
      return nodeIds.has(srcId) && nodeIds.has(tgtId);
    });

    // Deduplicate bidirectional relationship edges into a single link with directedLabels
    const relSeen = new Map<string, GraphLink>();
    const deduped: GraphLink[] = [];
    for (const l of validLinks) {
      if (l.linkKind !== 'relationship') {
        deduped.push(l);
        continue;
      }
      const srcId = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
      const tgtId = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
      const pairKey = [srcId, tgtId].sort().join('|');
      const existing = relSeen.get(pairKey);
      if (existing) {
        // Merge: store both directed labels
        existing.directedLabels = existing.directedLabels ?? {};
        existing.directedLabels[srcId] = l.label ?? '';
      } else {
        l.directedLabels = { [srcId]: l.label ?? '' };
        relSeen.set(pairKey, l);
        deduped.push(l);
      }
    }
    const validLinksDeduped = deduped;

    // Root group for zoom/pan
    const g = svg.append('g');
    gRef.current = g;

    // Zoom behaviour
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        g.attr('transform', event.transform.toString());
      });

    svg.call(zoom);

    // Click on empty canvas → revert inspector to current scene
    svg.on('click', (event: MouseEvent) => {
      // Only fire when clicking the SVG background, not a node
      if (event.target === svgRef.current) {
        const currentKey = resolvedSceneKeys[state.currentSceneIndex];
        if (currentKey) {
          dispatch({ type: 'SET_INSPECTOR', context: { type: 'scene', sceneId: currentKey } });
          dispatch({ type: 'SELECT_KNOWLEDGE_ENTITY', entityId: null });
        }
      }
    });

    // Force simulation
    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        'link',
        d3
          .forceLink<GraphNode, GraphLink>(validLinksDeduped)
          .id((d) => d.id)
          .distance(160),
      )
      .force('charge', d3.forceManyBody<GraphNode>().strength(-400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force(
        'collide',
        d3.forceCollide<GraphNode>().radius((d) => {
          if (d.kind === 'character') return (ROLE_RADIUS[d.role ?? 'recurring'] ?? 18) + 20;
          if (d.kind === 'knowledge') return 28;
          return LOCATION_SIZE / 2 + 20;
        }),
      );

    simulationRef.current = simulation;

    // ── Links ─────────────────────────────────────────────────────────────
    const nonRelLinks = validLinksDeduped.filter((l) => l.linkKind !== 'relationship');
    const relLinks = validLinksDeduped.filter((l) => l.linkKind === 'relationship');

    // Non-relationship links as straight lines
    const linkSelection = g
      .append('g')
      .attr('class', 'links')
      .selectAll<SVGLineElement, GraphLink>('line')
      .data(nonRelLinks)
      .join('line')
      .attr('class', 'graph-edge')
      .attr('stroke', (d) => {
        if (d.linkKind === 'character-location') return 'rgba(59, 130, 246, 0.8)';
        if (d.linkKind === 'knowledge') return 'rgba(255, 255, 255, 0.35)';
        return 'rgba(255, 255, 255, 0.25)';
      })
      .attr('stroke-opacity', (d) => {
        if (d.linkKind === 'character-location') return 0.8;
        if (d.linkKind === 'spatial') return 0.6;
        return 0.5;
      })
      .attr('stroke-width', (d) => {
        if (d.linkKind === 'character-location') return 2;
        if (d.linkKind === 'knowledge') return 1;
        if (d.linkKind === 'spatial') return 1;
        return 1.5;
      })
      .attr('stroke-dasharray', (d) => {
        if (d.linkKind === 'spatial') return '4 4';
        if (d.linkKind === 'character-location') return '2 3';
        return null;
      });

    // Relationship links as straight lines (hidden by default, shown on node select)
    const relLinkSelection = g
      .select('g.links')
      .selectAll<SVGLineElement, GraphLink>('line.graph-rel-edge')
      .data(relLinks)
      .join('line')
      .attr('class', 'graph-edge graph-rel-edge')
      .attr('stroke', (d) => {
        const v = d.valence ?? 0;
        return v >= 0 ? 'rgba(74, 222, 128, 0.85)' : 'rgba(248, 113, 113, 0.85)';
      })
      .attr('stroke-opacity', (d) => Math.max(0.4, Math.abs(d.valence ?? 0)))
      .attr('stroke-width', 1.5);

    // Relationship labels at midpoints
    const linkLabelSelection = g
      .append('g')
      .attr('class', 'link-labels')
      .style('display', showEdgeLabels ? '' : 'none')
      .selectAll<SVGTextElement, GraphLink>('text')
      .data(relLinks)
      .join('text')
      .attr('class', 'graph-label graph-rel-label')
      .attr('text-anchor', 'middle')
      .attr('dy', '-6')
      .style('font-size', '9px')
      .style('fill', '#999999')
      .text((d) => d.label ?? '');

    // ── Node groups ───────────────────────────────────────────────────────
    const nodeGroup = g
      .append('g')
      .attr('class', 'nodes')
      .selectAll<SVGGElement, GraphNode>('g')
      .data(nodes, (d) => d.id)
      .join('g')
      .attr('class', 'graph-node')
      .on('click', (_event, d) => {
        _event.stopPropagation();
        if (d.kind === 'character') handleCharacterClickRef.current(d.id);
        if (d.kind === 'location') handleLocationClickRef.current(d.id);
      })
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          }),
      );

    // Character circles — scale by usage in overview mode
    const maxUsage = graphViewMode === 'overview'
      ? Math.max(1, ...nodes.filter((n) => n.kind === 'character').map((n) => n.usageCount ?? 1))
      : 1;
    const maxLocUsage = graphViewMode === 'overview'
      ? Math.max(1, ...nodes.filter((n) => n.kind === 'location').map((n) => n.usageCount ?? 1))
      : 1;

    nodeGroup
      .filter((d) => d.kind === 'character')
      .append('circle')
      .attr('r', (d) => {
        if (graphViewMode === 'overview') {
          const base = 12;
          const scale = 18;
          return base + scale * ((d.usageCount ?? 1) / maxUsage);
        }
        return ROLE_RADIUS[d.role ?? 'recurring'];
      })
      .attr('fill', (d) => ROLE_FILL[d.role ?? 'recurring']);

    // Location rounded rects — scale by usage in overview mode
    nodeGroup
      .filter((d) => d.kind === 'location')
      .each(function (d) {
        const sel = d3.select(this);
        const size = graphViewMode === 'overview'
          ? LOCATION_SIZE * (0.7 + 0.6 * ((d.usageCount ?? 1) / maxLocUsage))
          : LOCATION_SIZE;
        sel.append('rect')
          .attr('x', -size / 2)
          .attr('y', -size / 2)
          .attr('width', size)
          .attr('height', size)
          .attr('rx', LOCATION_RX)
          .attr('fill', LOCATION_FILL);
      });

    // Knowledge nodes
    nodeGroup
      .filter((d) => d.kind === 'knowledge')
      .append('circle')
      .attr('r', 8)
      .attr('fill', (d) => KNOWLEDGE_FILL[d.knowledgeType ?? 'knows'] ?? DEFAULT_KNOWLEDGE_FILL)
      .attr('opacity', (d) => KNOWLEDGE_OPACITY[d.knowledgeType ?? 'knows'] ?? DEFAULT_KNOWLEDGE_OPACITY);

    // Character / location labels
    nodeGroup
      .filter((d) => d.kind !== 'knowledge')
      .append('text')
      .attr('class', 'graph-label')
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => {
        if (d.kind === 'character') return ROLE_RADIUS[d.role ?? 'recurring'] + 14;
        return LOCATION_SIZE / 2 + 14;
      })
      .text((d) => {
        if (graphViewMode === 'overview' && d.usageCount != null) {
          return `${d.label} (${d.usageCount})`;
        }
        return d.label;
      });

    // Knowledge node labels (tiny)
    nodeGroup
      .filter((d) => d.kind === 'knowledge')
      .append('text')
      .attr('class', 'graph-label')
      .attr('text-anchor', 'middle')
      .attr('dy', 18)
      .style('font-size', '8px')
      .style('fill', '#666666')
      .text((d) => d.label);

    // ── Tick ──────────────────────────────────────────────────────────────
    simulation.on('tick', () => {
      linkSelection
        .attr('x1', (d) => ((d.source as GraphNode).x ?? 0))
        .attr('y1', (d) => ((d.source as GraphNode).y ?? 0))
        .attr('x2', (d) => ((d.target as GraphNode).x ?? 0))
        .attr('y2', (d) => ((d.target as GraphNode).y ?? 0));

      relLinkSelection
        .attr('x1', (d) => ((d.source as GraphNode).x ?? 0))
        .attr('y1', (d) => ((d.source as GraphNode).y ?? 0))
        .attr('x2', (d) => ((d.target as GraphNode).x ?? 0))
        .attr('y2', (d) => ((d.target as GraphNode).y ?? 0));

      linkLabelSelection
        .attr('x', (d) => {
          const sx = (d.source as GraphNode).x ?? 0;
          const tx = (d.target as GraphNode).x ?? 0;
          return (sx + tx) / 2;
        })
        .attr('y', (d) => {
          const sy = (d.source as GraphNode).y ?? 0;
          const ty = (d.target as GraphNode).y ?? 0;
          return (sy + ty) / 2;
        });

      nodeGroup.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => {
      simulation.stop();
      simulationRef.current = null;
      gRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrative, activeArcId, graphViewMode, currentWorldBuildId]);

  // ── Lightweight: update selected node highlight + relationship edges ──
  useEffect(() => {
    const g = gRef.current;
    if (!g) return;
    g.select('g.nodes')
      .selectAll<SVGGElement, GraphNode>('g')
      .classed('node-selected', (d) => d.id === selectedNodeId);

    // Show relationship edges only for the selected character/location
    const isConnected = (d: GraphLink) => {
      if (!selectedNodeId) return false;
      const srcId = typeof d.source === 'string' ? d.source : (d.source as GraphNode).id;
      const tgtId = typeof d.target === 'string' ? d.target : (d.target as GraphNode).id;
      return srcId === selectedNodeId || tgtId === selectedNodeId;
    };

    // Highlight connected relationship edges
    g.select('g.links')
      .selectAll<SVGLineElement, GraphLink>('line.graph-rel-edge')
      .attr('stroke-opacity', (d) => {
        if (!selectedNodeId) return Math.max(0.4, Math.abs(d.valence ?? 0));
        return isConnected(d) ? 1 : 0.15;
      });

    // Update labels: show directional label when a node is selected
    g.select('g.link-labels')
      .selectAll<SVGTextElement, GraphLink>('text.graph-rel-label')
      .attr('fill-opacity', (d) => {
        if (!selectedNodeId) return 1;
        return isConnected(d) ? 1 : 0.3;
      })
      .text((d) => {
        if (!selectedNodeId || !d.directedLabels) return d.label ?? '';
        return d.directedLabels[selectedNodeId] ?? d.label ?? '';
      });
  }, [selectedNodeId]);

  // ── Toggle edge label visibility ──
  useEffect(() => {
    const g = gRef.current;
    if (!g) return;
    g.select('g.link-labels').style('display', showEdgeLabels ? '' : 'none');
  }, [showEdgeLabels]);

  // ── Lightweight: toggle knowledge subgraph without full rebuild ──
  useEffect(() => {
    const g = gRef.current;
    const simulation = simulationRef.current;
    if (!g || !simulation || !narrative) return;

    // Remove previous knowledge nodes, links, and hull
    g.select('g.nodes').selectAll<SVGGElement, GraphNode>('g')
      .filter((d) => d.kind === 'knowledge')
      .remove();
    g.select('g.links').selectAll<SVGLineElement, GraphLink>('line')
      .filter((d) => d.linkKind === 'knowledge')
      .remove();
    g.select('g.link-labels').selectAll<SVGTextElement, GraphLink>('text')
      .filter((d) => d.linkKind === 'knowledge')
      .remove();
    g.select('.knowledge-hull').remove();

    // Remove knowledge nodes/links from simulation
    const baseNodes = nodesRef.current.filter((n) => n.kind !== 'knowledge');
    const currentLinks = (simulation.force('link') as d3.ForceLink<GraphNode, GraphLink>).links();
    const baseLinks = currentLinks.filter((l) => (l as GraphLink).linkKind !== 'knowledge');

    if (!selectedKnowledgeEntity) {
      nodesRef.current = baseNodes;
      simulation.nodes(baseNodes);
      (simulation.force('link') as d3.ForceLink<GraphNode, GraphLink>).links(baseLinks);
      simulation.force('hull-repulsion', null);
      simulation.alpha(0.1).restart();
      return;
    }

    const entity = narrative.characters[selectedKnowledgeEntity] ?? narrative.locations[selectedKnowledgeEntity];
    if (!entity) return;

    const kg = entity.knowledge;
    const eid = entity.id;
    const parentNode = baseNodes.find((n) => n.id === eid);
    if (!parentNode) return;

    // Create knowledge nodes
    const knowledgeNodes: GraphNode[] = kg.nodes.map((kn) => ({
      id: `k-${eid}-${kn.id}`,
      kind: 'knowledge' as NodeKind,
      label: kn.content,
      knowledgeType: kn.type,
      parentCharacterId: eid,
      x: (parentNode.x ?? 0) + (Math.random() - 0.5) * 60,
      y: (parentNode.y ?? 0) + (Math.random() - 0.5) * 60,
    }));

    const allNodes = [...baseNodes, ...knowledgeNodes];
    nodesRef.current = allNodes;

    // Create knowledge links
    const knowledgeNodeMap = new Map(knowledgeNodes.map((n) => [n.id, n]));
    const knowledgeLinks: GraphLink[] = [];

    for (const kn of kg.nodes) {
      const target = knowledgeNodeMap.get(`k-${eid}-${kn.id}`);
      if (target) {
        knowledgeLinks.push({
          id: `klink-${eid}-${kn.id}`,
          source: parentNode,
          target,
          linkKind: 'knowledge',
        });
      }
    }

    for (const ke of kg.edges) {
      const src = knowledgeNodeMap.get(`k-${eid}-${ke.from}`);
      const tgt = knowledgeNodeMap.get(`k-${eid}-${ke.to}`);
      if (src && tgt) {
        knowledgeLinks.push({
          id: `kedge-${eid}-${ke.from}-${ke.to}`,
          source: src,
          target: tgt,
          linkKind: 'knowledge',
          knowledgeEdgeType: ke.type,
        });
      }
    }

    // Add knowledge link elements
    const linksGroup = g.select<SVGGElement>('g.links');
    const knowledgeLinkEls = linksGroup
      .selectAll<SVGLineElement, GraphLink>('line.knowledge')
      .data(knowledgeLinks, (d) => d.id)
      .join('line')
      .attr('class', 'graph-edge knowledge')
      .attr('stroke', 'rgba(255, 255, 255, 0.35)')
      .attr('stroke-opacity', 0.5)
      .attr('stroke-width', 1);

    // Add knowledge edge type labels
    const linkLabelsGroup = g.select<SVGGElement>('g.link-labels');
    const edgeTypedLinks = knowledgeLinks.filter((l) => l.knowledgeEdgeType);
    const knowledgeEdgeLabels = linkLabelsGroup
      .selectAll<SVGTextElement, GraphLink>('text.knowledge-edge-label')
      .data(edgeTypedLinks, (d) => d.id)
      .join('text')
      .attr('class', 'graph-label knowledge-edge-label')
      .attr('text-anchor', 'middle')
      .style('font-size', '7px')
      .style('fill', 'rgba(255, 255, 255, 0.4)')
      .text((d) => d.knowledgeEdgeType ?? '');

    // Add knowledge node elements
    const nodesGroup = g.select<SVGGElement>('g.nodes');
    const knowledgeNodeEls = nodesGroup
      .selectAll<SVGGElement, GraphNode>('g.knowledge-node')
      .data(knowledgeNodes, (d) => d.id)
      .join('g')
      .attr('class', 'graph-node knowledge-node');

    knowledgeNodeEls
      .append('circle')
      .attr('r', 8)
      .attr('fill', (d) => KNOWLEDGE_FILL[d.knowledgeType ?? 'knows'] ?? DEFAULT_KNOWLEDGE_FILL)
      .attr('opacity', (d) => KNOWLEDGE_OPACITY[d.knowledgeType ?? 'knows'] ?? DEFAULT_KNOWLEDGE_OPACITY);

    knowledgeNodeEls
      .append('text')
      .attr('class', 'graph-label')
      .attr('text-anchor', 'middle')
      .attr('dy', 18)
      .style('font-size', '8px')
      .style('fill', '#666666')
      .text((d) => d.label);

    // Add curved convex hull "net" behind knowledge subgraph
    const hullPadding = 30;
    const hullAllNodes = [parentNode, ...knowledgeNodes];
    const hullPath = g.insert('path', 'g.links')
      .attr('class', 'knowledge-hull')
      .attr('fill', 'rgba(245, 158, 11, 0.04)')
      .attr('stroke', 'rgba(245, 158, 11, 0.25)')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '6 4');

    const hullLine = d3.line<[number, number]>()
      .x((d) => d[0])
      .y((d) => d[1])
      .curve(d3.curveCatmullRomClosed.alpha(0.7));

    function updateHull() {
      const points: [number, number][] = hullAllNodes.map((n) => [n.x ?? 0, n.y ?? 0]);
      if (points.length < 3) {
        // For 1-2 points, draw a circle around them
        const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
        const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
        const r = Math.max(40, ...points.map((p) => Math.hypot(p[0] - cx, p[1] - cy))) + hullPadding;
        hullPath.attr('d', `M ${cx - r},${cy} A ${r},${r} 0 1,0 ${cx + r},${cy} A ${r},${r} 0 1,0 ${cx - r},${cy} Z`);
        return;
      }
      const hull = d3.polygonHull(points);
      if (!hull) return;
      // Expand hull outward by padding
      const centroid = d3.polygonCentroid(hull);
      const expanded = hull.map(([x, y]): [number, number] => {
        const dx = x - centroid[0];
        const dy = y - centroid[1];
        const dist = Math.hypot(dx, dy) || 1;
        return [x + (dx / dist) * hullPadding, y + (dy / dist) * hullPadding];
      });
      hullPath.attr('d', hullLine(expanded));
    }

    // Custom force: repel non-subgraph nodes away from hull boundary
    const hullNodeIds = new Set(hullAllNodes.map((n) => n.id));
    const hullRepulsionStrength = 120;
    const hullRepulsionRadius = 60; // how far beyond the hull padding the force reaches

    simulation.force('hull-repulsion', () => {
      // Compute current hull boundary
      const hullPoints: [number, number][] = hullAllNodes.map((n) => [n.x ?? 0, n.y ?? 0]);
      if (hullPoints.length < 2) return;

      const centroid: [number, number] = [
        hullPoints.reduce((s, p) => s + p[0], 0) / hullPoints.length,
        hullPoints.reduce((s, p) => s + p[1], 0) / hullPoints.length,
      ];

      // For each non-hull node, push it away from the hull centroid
      // if it's within the repulsion zone
      const effectiveRadius = (hullPoints.length < 3)
        ? Math.max(40, ...hullPoints.map((p) => Math.hypot(p[0] - centroid[0], p[1] - centroid[1]))) + hullPadding
        : (() => {
            const hull = d3.polygonHull(hullPoints);
            if (!hull) return hullPadding;
            return Math.max(...hull.map(([x, y]) => Math.hypot(x - centroid[0], y - centroid[1]))) + hullPadding;
          })();

      const outerBound = effectiveRadius + hullRepulsionRadius;

      for (const node of allNodes) {
        if (hullNodeIds.has(node.id)) continue;
        const nx = node.x ?? 0;
        const ny = node.y ?? 0;
        const dx = nx - centroid[0];
        const dy = ny - centroid[1];
        const dist = Math.hypot(dx, dy) || 1;

        if (dist < outerBound) {
          // Strength increases as node gets closer to hull
          const overlap = outerBound - dist;
          const force = (overlap / hullRepulsionRadius) * hullRepulsionStrength;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          node.vx = (node.vx ?? 0) + fx * 0.01;
          node.vy = (node.vy ?? 0) + fy * 0.01;
        }
      }
    });

    // Update simulation
    simulation.nodes(allNodes);
    (simulation.force('link') as d3.ForceLink<GraphNode, GraphLink>)
      .links([...baseLinks, ...knowledgeLinks]);
    simulation.alpha(0.5).restart();

    // Tick handler for knowledge elements
    simulation.on('tick.knowledge', () => {
      knowledgeLinkEls
        .attr('x1', (d) => ((d.source as GraphNode).x ?? 0))
        .attr('y1', (d) => ((d.source as GraphNode).y ?? 0))
        .attr('x2', (d) => ((d.target as GraphNode).x ?? 0))
        .attr('y2', (d) => ((d.target as GraphNode).y ?? 0));

      knowledgeEdgeLabels
        .attr('x', (d) => {
          const sx = (d.source as GraphNode).x ?? 0;
          const tx = (d.target as GraphNode).x ?? 0;
          return (sx + tx) / 2;
        })
        .attr('y', (d) => {
          const sy = (d.source as GraphNode).y ?? 0;
          const ty = (d.target as GraphNode).y ?? 0;
          return (sy + ty) / 2 - 4;
        });

      knowledgeNodeEls.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);

      updateHull();
    });
  }, [selectedKnowledgeEntity, narrative]);

  // ── Lightweight intra-arc update: character-location links on scene change ──
  useEffect(() => {
    const g = gRef.current;
    const simulation = simulationRef.current;
    if (!g || !simulation || !narrative || !activeArcId) return;

    const activeArc = narrative.arcs[activeArcId];
    if (!activeArc) return;

    const positions = computeCharacterPositions(activeArc, narrative.scenes, state.currentSceneIndex, resolvedSceneKeys);

    // Resolve new links against existing simulation nodes
    const nodeMap = new Map(nodesRef.current.map((n) => [n.id, n]));
    const resolvedNewLinks: GraphLink[] = [];
    for (const [charId, locId] of Object.entries(positions)) {
      const charNode = nodeMap.get(charId);
      const locNode = nodeMap.get(locId);
      if (charNode && locNode) {
        resolvedNewLinks.push({
          id: `charloc-${charId}-${locId}`,
          source: charNode,
          target: locNode,
          linkKind: 'character-location',
        });
      }
    }

    // Update character-location links in the DOM — bind resolved links so
    // source/target are actual node objects with live x/y coordinates
    const linksGroup = g.select<SVGGElement>('g.links');
    linksGroup.selectAll<SVGLineElement, GraphLink>('line')
      .filter((d) => d.linkKind === 'character-location')
      .remove();

    const newLinkEls = linksGroup
      .selectAll<SVGLineElement, GraphLink>('line.charloc')
      .data(resolvedNewLinks, (d) => d.id)
      .join('line')
      .attr('class', 'graph-edge charloc')
      .attr('stroke', 'rgba(59, 130, 246, 0.8)')
      .attr('stroke-opacity', 0.8)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '2 3');

    // Swap char-loc links in the simulation force
    const currentLinks = (simulation.force('link') as d3.ForceLink<GraphNode, GraphLink>).links();
    const nonCharLocLinks = currentLinks.filter((l) => (l as GraphLink).linkKind !== 'character-location');
    const allLinks = [...nonCharLocLinks, ...resolvedNewLinks];

    (simulation.force('link') as d3.ForceLink<GraphNode, GraphLink>)
      .links(allLinks);

    // Gentle reheat — no jarring re-layout
    simulation.alpha(0.1).restart();

    // Tick handler for new link elements
    simulation.on('tick.charloc', () => {
      newLinkEls
        .attr('x1', (d) => ((d.source as GraphNode).x ?? 0))
        .attr('y1', (d) => ((d.source as GraphNode).y ?? 0))
        .attr('x2', (d) => ((d.target as GraphNode).x ?? 0))
        .attr('y2', (d) => ((d.target as GraphNode).y ?? 0));
    });
  }, [narrative, activeArcId, state.currentSceneIndex]);

  // No active narrative placeholder
  if (!narrative) {
    return (
      <div className="relative h-full w-full flex items-center justify-center">
        <span className="text-text-dim text-sm">
          Create a narrative to begin
        </span>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Edge labels toggle (top-left) */}
      <label className="absolute top-2 left-2 z-10 flex items-center gap-1.5 px-2 py-1.5 rounded bg-bg-surface text-[11px] leading-none text-text-dim hover:text-text-default cursor-pointer select-none">
        <input
          type="checkbox"
          checked={showEdgeLabels}
          onChange={() => setShowEdgeLabels((v) => !v)}
          className="accent-accent-cta w-3 h-3"
        />
        Labels
      </label>
      {/* Graph view mode toggle (top-right) */}
      <div className="absolute top-2 right-2 z-10 flex items-center rounded bg-bg-surface text-[11px] leading-none">
        <button
          className={`px-2 py-1.5 rounded-l transition-colors ${
            graphViewMode === 'scene' ? 'text-accent-cta' : 'text-text-dim hover:text-text-default'
          }`}
          onClick={() => dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode: 'scene' })}
        >
          Scene
        </button>
        <div className="w-px h-3.5 bg-border" />
        <button
          className={`px-2 py-1.5 rounded-r transition-colors ${
            graphViewMode === 'overview' ? 'text-accent-cta' : 'text-text-dim hover:text-text-default'
          }`}
          onClick={() => dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode: 'overview' })}
        >
          World
        </button>
      </div>
      <svg
        ref={svgRef}
        className="h-full w-full"
        style={{ background: 'transparent' }}
      />
      {/* Fullscreen toggle */}
      <FullscreenButton />
    </div>
  );
}
