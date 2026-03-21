'use client';

import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import * as d3 from 'd3';
import { useStore } from '@/lib/store';
import { GRAPH_CONTINUITY_LIMIT } from '@/lib/constants';
import { getContinuityNodesAtScene, getRelationshipsAtScene } from '@/lib/scene-filter';
import { buildCumulativeWorldKnowledge } from '@/lib/narrative-utils';
import type {
  Character,
  Location,
  RelationshipEdge,
  CharacterRole,
  Arc,
  Scene,
  WorldBuildCommit,
} from '@/types/narrative';
import EvalBar from '@/components/timeline/EvalBar';

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

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  id: string;
  linkKind: 'relationship' | 'spatial' | 'knowledge' | 'character-location';
  label?: string;
  valence?: number;
  /** For bidirectional pairs: labels for each direction (sourceId → label) */
  directedLabels?: Record<string, string>;
}

// ── Helper: compute connected components (groups) ──────────────────────────

function computeGroups(
  nodes: GraphNode[],
  links: GraphLink[],
): GraphNode[][] {
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.id, new Set());
  for (const l of links) {
    const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
    const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
    adj.get(s)?.add(t);
    adj.get(t)?.add(s);
  }

  const visited = new Set<string>();
  const groups: GraphNode[][] = [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    const component: GraphNode[] = [];
    const stack = [node.id];
    while (stack.length) {
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const n = nodeMap.get(id);
      if (n) component.push(n);
      for (const neighbour of adj.get(id) ?? []) {
        if (!visited.has(neighbour)) stack.push(neighbour);
      }
    }
    groups.push(component);
  }

  // Sort descending by size
  groups.sort((a, b) => b.length - a.length);
  return groups;
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

/** Interpolate from cool (blue) to hot (red) matching force graph colors */
function heatColor(t: number): string {
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

const CONTINUITY_FILL: Record<string, string> = {
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

const DEFAULT_CONTINUITY_FILL = '#FFFFFF';
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
      for (const [charId, mv] of Object.entries(scene.characterMovements)) {
        positions[charId] = mv.locationId;
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
      className="absolute bottom-4 right-4 z-30 w-9 h-9 flex items-center justify-center glass-pill text-text-dim hover:text-text-primary transition-colors"
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

// ── Knowledge Graph Views (Insight + Nexus) ─────────────────────────────────

const WK_TYPE_COLORS: Record<string, string> = {
  law: '#FBBF24',      // vivid gold
  system: '#38BDF8',   // vivid sky blue
  concept: '#A78BFA',  // vivid violet
  tension: '#FB7185',  // vivid rose
};

const WK_TYPE_GLOW: Record<string, string> = {
  law: '0 0 12px #FBBF2480, 0 0 4px #FBBF2440',
  system: '0 0 12px #38BDF880, 0 0 4px #38BDF840',
  concept: '0 0 12px #A78BFA80, 0 0 4px #A78BFA40',
  tension: '0 0 12px #FB718580, 0 0 4px #FB718540',
};

type WKNode = d3.SimulationNodeDatum & { id: string; concept: string; type: string; degree: number };
type WKLink = d3.SimulationLinkDatum<WKNode> & { relation: string };

function KnowledgeGraphView({ narrative, resolvedKeys, currentIndex, mode }: {
  narrative: import('@/types/narrative').NarrativeState;
  resolvedKeys: string[];
  currentIndex: number;
  mode: 'spark' | 'codex';
}) {
  const { dispatch } = useStore();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simRef = useRef<d3.Simulation<WKNode, WKLink> | null>(null);
  const gRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const nodesRef = useRef<WKNode[]>([]);
  const [showLabels, setShowLabels] = useState(true);
  const [showRelations, setShowRelations] = useState(false);
  const [showTypes, setShowTypes] = useState(true);
  const [showEval, setShowEval] = useState(true);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; concept: string; type: string; degree: number; connections: string[] } | null>(null);

  const graphData = useMemo(() => {
    if (mode === 'spark') {
      const key = resolvedKeys[currentIndex];
      const scene = narrative.scenes[key];
      const wb = narrative.worldBuilds[key];
      const wkm = scene?.worldKnowledgeMutations ?? wb?.worldKnowledgeMutations;
      if (!wkm) return { nodes: {}, edges: [] };
      const nodes: Record<string, import('@/types/narrative').WorldKnowledgeNode> = {};
      for (const n of wkm.addedNodes ?? []) {
        nodes[n.id] = { id: n.id, concept: n.concept, type: n.type };
      }
      for (const e of wkm.addedEdges ?? []) {
        if (!nodes[e.from] && narrative.worldKnowledge.nodes[e.from]) nodes[e.from] = narrative.worldKnowledge.nodes[e.from];
        if (!nodes[e.to] && narrative.worldKnowledge.nodes[e.to]) nodes[e.to] = narrative.worldKnowledge.nodes[e.to];
      }
      return { nodes, edges: wkm.addedEdges ?? [] };
    }
    return buildCumulativeWorldKnowledge(narrative.scenes, resolvedKeys, currentIndex, undefined, narrative.worldBuilds);
  }, [narrative, resolvedKeys, currentIndex, mode]);

  // Scene-added node IDs for highlight in nexus mode
  const sceneNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (mode === 'codex') {
      const key = resolvedKeys[currentIndex];
      const scene = narrative.scenes[key];
      const wb = narrative.worldBuilds[key];
      const wkm = scene?.worldKnowledgeMutations ?? wb?.worldKnowledgeMutations;
      for (const n of wkm?.addedNodes ?? []) ids.add(n.id);
    }
    return ids;
  }, [narrative, resolvedKeys, currentIndex, mode]);

  // Adjacency map for tooltips
  const adjMap = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of graphData.edges) {
      const fc = graphData.nodes[e.from]?.concept;
      const tc = graphData.nodes[e.to]?.concept;
      if (!fc || !tc) continue;
      m.set(e.from, [...(m.get(e.from) ?? []), tc]);
      m.set(e.to, [...(m.get(e.to) ?? []), fc]);
    }
    return m;
  }, [graphData]);

  // ── Initial setup: create SVG structure, zoom, glow filters (once) ──
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const g = svg.append('g');
    gRef.current = g;

    // Glow filters
    const defs = svg.append('defs');
    for (const [type, color] of Object.entries(WK_TYPE_COLORS)) {
      const filter = defs.append('filter').attr('id', `glow-${type}`).attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
      filter.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'blur');
      filter.append('feFlood').attr('flood-color', color).attr('flood-opacity', '0.6').attr('result', 'color');
      filter.append('feComposite').attr('in', 'color').attr('in2', 'blur').attr('operator', 'in').attr('result', 'glow');
      const merge = filter.append('feMerge');
      merge.append('feMergeNode').attr('in', 'glow');
      merge.append('feMergeNode').attr('in', 'SourceGraphic');
    }

    // Zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 4])
      .on('zoom', (event) => g.attr('transform', event.transform));
    svg.call(zoom);
    const width = svgEl.clientWidth ?? 800;
    const height = svgEl.clientHeight ?? 600;
    svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(0.9));

    // Create link and node groups (order matters for layering)
    g.append('g').attr('class', 'wk-links');
    g.append('g').attr('class', 'wk-nodes');
    g.append('g').attr('class', 'wk-labels');

    // Simulation
    const sim = d3.forceSimulation<WKNode, WKLink>()
      .force('link', d3.forceLink<WKNode, WKLink>([]).id((d) => d.id).distance(140))
      .force('charge', d3.forceManyBody().strength(-500))
      .force('center', d3.forceCenter(0, 0))
      .force('collide', d3.forceCollide<WKNode>().radius(40));
    simRef.current = sim;

    return () => { sim.stop(); simRef.current = null; gRef.current = null; };
  }, []); // Only on mount

  // ── Data update: merge nodes/links into persistent simulation ──
  useEffect(() => {
    const sim = simRef.current;
    const g = gRef.current;
    if (!sim || !g) return;

    const nodeList = Object.values(graphData.nodes);
    const degreeMap = new Map<string, number>();
    for (const e of graphData.edges) {
      degreeMap.set(e.from, (degreeMap.get(e.from) ?? 0) + 1);
      degreeMap.set(e.to, (degreeMap.get(e.to) ?? 0) + 1);
    }
    const maxDegree = Math.max(...nodeList.map((n) => degreeMap.get(n.id) ?? 0), 1);
    const nodeRadius = (d: WKNode) => 5 + (d.degree / maxDegree) * 20;

    // Preserve positions of existing nodes
    const prevPos = new Map(nodesRef.current.map((n) => [n.id, { x: n.x, y: n.y }]));
    const simNodes: WKNode[] = nodeList.map((n) => {
      const prev = prevPos.get(n.id);
      return { id: n.id, concept: n.concept, type: n.type, degree: degreeMap.get(n.id) ?? 0, ...(prev ?? {}) };
    });
    nodesRef.current = simNodes;
    const nodeMap = new Map(simNodes.map((n) => [n.id, n]));
    const simLinks: WKLink[] = graphData.edges
      .filter((e) => nodeMap.has(e.from) && nodeMap.has(e.to))
      .map((e) => ({ source: nodeMap.get(e.from)!, target: nodeMap.get(e.to)!, relation: e.relation }));

    // Update links
    const linkSel = g.select<SVGGElement>('g.wk-links')
      .selectAll<SVGLineElement, WKLink>('line')
      .data(simLinks, (d) => `${(d.source as WKNode).id}-${(d.target as WKNode).id}`);
    linkSel.exit().remove();
    const linkEnter = linkSel.enter().append('line');
    const linkAll = linkEnter.merge(linkSel);
    linkAll
      .attr('stroke', (d) => {
        if (mode === 'codex' && sceneNodeIds.size > 0) {
          return sceneNodeIds.has((d.source as WKNode).id) || sceneNodeIds.has((d.target as WKNode).id) ? '#ffffff40' : '#ffffff10';
        }
        return '#ffffff20';
      })
      .attr('stroke-width', (d) => {
        const srcDeg = (d.source as WKNode).degree;
        const tgtDeg = (d.target as WKNode).degree;
        return Math.max(0.5, 0.5 + ((srcDeg + tgtDeg) / (maxDegree * 2)) * 3);
      });

    // Update nodes
    const nodeSel = g.select<SVGGElement>('g.wk-nodes')
      .selectAll<SVGCircleElement, WKNode>('circle')
      .data(simNodes, (d) => d.id);
    nodeSel.exit().remove();
    const nodeEnter = nodeSel.enter().append('circle').style('cursor', 'pointer');
    const nodeAll = nodeEnter.merge(nodeSel);
    nodeAll
      .attr('r', nodeRadius)
      .attr('fill', (d) => showTypes ? (WK_TYPE_COLORS[d.type] ?? '#888') : '#888')
      .attr('filter', (d) => showTypes ? `url(#glow-${d.type})` : 'none')
      .attr('opacity', (d) => mode === 'codex' && sceneNodeIds.size > 0 ? (sceneNodeIds.has(d.id) ? 1 : 0.35) : 0.9)
      .attr('stroke', (d) => mode === 'codex' && sceneNodeIds.has(d.id) ? '#fff' : 'transparent')
      .attr('stroke-width', 2);

    // Tooltip + drag events
    const drag = d3.drag<SVGCircleElement, WKNode>()
      .on('start', (event, d) => {
        if (!event.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
        setTooltip(null);
      })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on('end', (event, d) => {
        if (!event.active) sim.alphaTarget(0);
        d.fx = null; d.fy = null;
      });
    nodeAll.call(drag);

    nodeAll
      .on('mouseenter', (event, d) => {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        setTooltip({ x: event.clientX - rect.left, y: event.clientY - rect.top - 10, concept: d.concept, type: d.type, degree: d.degree, connections: adjMap.get(d.id) ?? [] });
      })
      .on('mouseleave', () => setTooltip(null))
      .on('click', (_event, d) => {
        _event.stopPropagation();
        dispatch({ type: 'SET_INSPECTOR', context: { type: 'knowledge', nodeId: d.id } });
      });

    // Update labels
    const labelSel = g.select<SVGGElement>('g.wk-labels')
      .selectAll<SVGTextElement, WKNode>('text')
      .data(simNodes, (d) => d.id);
    labelSel.exit().remove();
    const labelEnter = labelSel.enter().append('text').attr('text-anchor', 'middle');
    const labelAll = labelEnter.merge(labelSel);
    labelAll
      .attr('fill', (d) => showTypes ? (WK_TYPE_COLORS[d.type] ?? '#ccc') : '#ccc')
      .attr('font-size', (d) => `${Math.max(9, 9 + (d.degree / maxDegree) * 4)}px`)
      .attr('font-weight', (d) => d.degree >= maxDegree * 0.5 ? '600' : '400')
      .attr('display', showLabels ? 'block' : 'none')
      .attr('opacity', (d) => {
        if (mode === 'spark') return 0.95;
        if (mode === 'codex' && sceneNodeIds.size > 0) return sceneNodeIds.has(d.id) ? 1 : (d.degree >= 2 ? 0.6 : 0.25);
        return d.degree >= 2 ? 0.85 : 0.45;
      })
      .text((d) => {
        // Truncate at em dash or long descriptions for clean graph labels
        const dash = d.concept.indexOf(' — ');
        return dash > 0 ? d.concept.slice(0, dash) : d.concept.slice(0, 40) + (d.concept.length > 40 ? '…' : '');
      });

    // Relation labels on edges
    const relGroup = g.selectAll<SVGGElement, unknown>('g.wk-relations').data([0]);
    const relGroupEnter = relGroup.enter().append('g').attr('class', 'wk-relations');
    const relGroupAll = relGroupEnter.merge(relGroup);
    const relSel = relGroupAll
      .selectAll<SVGTextElement, WKLink>('text')
      .data(simLinks, (d) => `${(d.source as WKNode).id}-${(d.target as WKNode).id}-rel`);
    relSel.exit().remove();
    const relEnter = relSel.enter().append('text').attr('text-anchor', 'middle').attr('font-size', '8px');
    const relAll = relEnter.merge(relSel);
    relAll
      .attr('fill', '#ffffff30')
      .attr('display', showRelations ? 'block' : 'none')
      .text((d) => d.relation);

    // Update simulation
    sim.nodes(simNodes);
    (sim.force('link') as d3.ForceLink<WKNode, WKLink>).links(simLinks);
    (sim.force('collide') as d3.ForceCollide<WKNode>).radius((d) => nodeRadius(d) + 30);
    sim.on('tick', () => {
      linkAll
        .attr('x1', (d) => (d.source as WKNode).x ?? 0)
        .attr('y1', (d) => (d.source as WKNode).y ?? 0)
        .attr('x2', (d) => (d.target as WKNode).x ?? 0)
        .attr('y2', (d) => (d.target as WKNode).y ?? 0);
      nodeAll
        .attr('cx', (d) => d.x ?? 0)
        .attr('cy', (d) => d.y ?? 0);
      labelAll
        .attr('x', (d) => d.x ?? 0)
        .attr('y', (d) => d.y ?? 0)
        .attr('dy', (d) => -(nodeRadius(d) + 5));
      relAll
        .attr('x', (d) => ((d.source as WKNode).x! + (d.target as WKNode).x!) / 2)
        .attr('y', (d) => ((d.source as WKNode).y! + (d.target as WKNode).y!) / 2);
    });
    sim.alpha(0.5).restart();
  }, [graphData, mode, sceneNodeIds, showLabels, showRelations, showTypes, adjMap]);


  return (
    <div className="absolute inset-0 z-20">
      <svg ref={svgRef} className="h-full w-full" style={{ background: 'transparent' }} />
      {/* Controls (top-left) */}
      <div className="absolute top-2 left-2 z-30 flex items-center gap-0">
        <label className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-bg-surface text-[11px] leading-none text-text-dim hover:text-text-default cursor-pointer select-none">
          <input type="checkbox" checked={showLabels} onChange={() => setShowLabels((v) => !v)} className="accent-accent-cta w-3 h-3" />
          Labels
        </label>
        <label className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-bg-surface text-[11px] leading-none text-text-dim hover:text-text-default cursor-pointer select-none">
          <input type="checkbox" checked={showRelations} onChange={() => setShowRelations((v) => !v)} className="accent-accent-cta w-3 h-3" />
          Relations
        </label>
        <label className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-bg-surface text-[11px] leading-none text-text-dim hover:text-text-default cursor-pointer select-none">
          <input type="checkbox" checked={showTypes} onChange={() => setShowTypes((v) => !v)} className="accent-accent-cta w-3 h-3" />
          Types
        </label>
        <label className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-bg-surface text-[11px] leading-none text-text-dim hover:text-text-default cursor-pointer select-none">
          <input type="checkbox" checked={showEval} onChange={() => setShowEval((v) => !v)} className="accent-accent-cta w-3 h-3" />
          Eval
        </label>
      </div>
      {showEval && <EvalBar />}
      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute z-40 pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y - 12, transform: 'translate(-50%, -100%)' }}
        >
          <div className="bg-bg-elevated border border-border rounded-lg px-3 py-2 shadow-xl w-72">
            <div className="flex items-start gap-2 mb-1">
              <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-0.5" style={{ background: WK_TYPE_COLORS[tooltip.type] ?? '#888', boxShadow: `0 0 6px ${WK_TYPE_COLORS[tooltip.type] ?? '#888'}80` }} />
              <div>
                <span className="text-xs font-semibold text-text-primary">{tooltip.concept}</span>
                <span className="text-[10px] text-text-dim capitalize ml-1">({tooltip.type})</span>
              </div>
            </div>
            <div className="text-[10px] text-text-secondary">{tooltip.degree} connection{tooltip.degree !== 1 ? 's' : ''}</div>
            {tooltip.connections.length > 0 && (
              <div className="text-[10px] text-text-dim mt-0.5">↔ {tooltip.connections.join(', ')}</div>
            )}
          </div>
          <div className="flex justify-center"><div className="w-2.5 h-2.5 bg-bg-elevated border-r border-b border-border rotate-45 -mt-1.5" /></div>
        </div>
      )}
    </div>
  );
}

export default function WorldGraph() {
  const { state, dispatch } = useStore();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
  const gRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const handleCharacterClickRef = useRef<(id: string) => void>(() => {});
  const handleLocationClickRef = useRef<(id: string) => void>(() => {});

  const [showEdgeLabels, setShowEdgeLabels] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showEval, setShowEval] = useState(true);
  const [groups, setGroups] = useState<GraphNode[][]>([]);
  const [focusedGroupIndex, setFocusedGroupIndex] = useState<number | null>(null);
  const [nodeTooltip, setNodeTooltip] = useState<{ x: number; y: number; label: string; kind: string; imagePrompt: string } | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  const narrative = state.activeNarrative;
  const inspectorContext = state.inspectorContext;
  const selectedKnowledgeEntity = state.selectedKnowledgeEntity;
  const graphViewMode = state.graphViewMode;

  const resolvedSceneKeys = state.resolvedSceneKeys;

  const currentSceneKey = resolvedSceneKeys[state.currentSceneIndex] ?? null;

  const activeArcId = useMemo(() => {
    if (!narrative || !currentSceneKey) return null;
    return Object.values(narrative.arcs).find((a) => a.sceneIds.includes(currentSceneKey))?.id ?? null;
  }, [narrative, currentSceneKey]);

  const currentScene = useMemo(() => {
    if (!narrative || !currentSceneKey) return null;
    return narrative.scenes[currentSceneKey] ?? null;
  }, [narrative, currentSceneKey]);

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

    // SVG defs for clip paths (used for node images)
    const defs = svg.append('defs');

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
        // Expansion mode: show expansion elements + connected existing entities
        const manifest = currentWorldBuild.expansionManifest;
        const expandedCharIds = new Set(manifest.characterIds);
        const expandedLocIds = new Set(manifest.locationIds);

        // Include relationships that touch at least one new character
        const filteredRels = narrative.relationships.filter(
          (r) => expandedCharIds.has(r.from) || expandedCharIds.has(r.to),
        );

        // Collect existing character IDs that are connected via relationships
        const connectedCharIds = new Set(expandedCharIds);
        for (const rel of filteredRels) {
          connectedCharIds.add(rel.from);
          connectedCharIds.add(rel.to);
        }

        // Collect existing location IDs that are parents of new locations
        const connectedLocIds = new Set(expandedLocIds);
        for (const locId of expandedLocIds) {
          const loc = narrative.locations[locId];
          if (loc?.parentId && narrative.locations[loc.parentId]) {
            connectedLocIds.add(loc.parentId);
          }
        }

        const filteredChars = Object.fromEntries(
          Object.entries(narrative.characters).filter(([id]) => connectedCharIds.has(id)),
        );
        const filteredLocs = Object.fromEntries(
          Object.entries(narrative.locations).filter(([id]) => connectedLocIds.has(id)),
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

        // Relationships filtered to current scene (valence + visibility)
        const sceneRelationships = getRelationshipsAtScene(
          narrative,
          resolvedSceneKeys,
          state.currentSceneIndex,
        );

        if (activeArc) {
          const activeCharIds = new Set(activeArc.activeCharacterIds);
          const activeLocIds = new Set(activeArc.locationIds);

          filteredCharacters = Object.fromEntries(
            Object.entries(narrative.characters).filter(([id]) => activeCharIds.has(id)),
          );
          filteredLocations = Object.fromEntries(
            Object.entries(narrative.locations).filter(([id]) => activeLocIds.has(id)),
          );
          filteredRelationships = sceneRelationships.filter(
            (r) => activeCharIds.has(r.from) && activeCharIds.has(r.to),
          );

        } else {
          filteredCharacters = narrative.characters;
          filteredLocations = narrative.locations;
          filteredRelationships = sceneRelationships;
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

    // Backfill usageCount for scene mode (overview already sets it)
    if (graphViewMode !== 'overview') {
      const charUsage: Record<string, number> = {};
      const locUsage: Record<string, number> = {};
      for (const scene of Object.values(narrative.scenes)) {
        for (const pid of scene.participantIds) charUsage[pid] = (charUsage[pid] ?? 0) + 1;
        if (scene.locationId) locUsage[scene.locationId] = (locUsage[scene.locationId] ?? 0) + 1;
      }
      for (const n of nodes) {
        if (n.kind === 'character') n.usageCount = charUsage[n.id] ?? 1;
        if (n.kind === 'location') n.usageCount = locUsage[n.id] ?? 1;
      }
    }

    // Store nodes ref for intra-arc updates
    nodesRef.current = nodes;

    // Compute connected groups and reset focus
    setGroups(computeGroups(nodes, links));
    setFocusedGroupIndex(null);

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
    zoomRef.current = zoom;

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

    // Character / location usage stats for sizing and heatmap
    const scaleByUsage = true;
    const charNodes = nodes.filter((n) => n.kind === 'character');
    const locNodes = nodes.filter((n) => n.kind === 'location');
    const charUsages = charNodes.map((n) => n.usageCount ?? 1);
    const locUsages = locNodes.map((n) => n.usageCount ?? 1);
    const minCharUsage = scaleByUsage && charUsages.length > 0 ? Math.min(...charUsages) : 1;
    const maxCharUsage = scaleByUsage && charUsages.length > 0 ? Math.max(...charUsages) : 1;
    const minLocUsage = scaleByUsage && locUsages.length > 0 ? Math.min(...locUsages) : 1;
    const maxLocUsage = scaleByUsage && locUsages.length > 0 ? Math.max(...locUsages) : 1;
    const charRange = Math.max(1, maxCharUsage - minCharUsage);
    const locRange = Math.max(1, maxLocUsage - minLocUsage);
    const normChar = (d: GraphNode) => ((d.usageCount ?? 1) - minCharUsage) / charRange;
    const normLoc = (d: GraphNode) => ((d.usageCount ?? 1) - minLocUsage) / locRange;
    const CHAR_MIN_R = 12;
    const CHAR_MAX_R = 30;
    const LOC_MIN_SCALE = 0.6;
    const LOC_MAX_SCALE = 1.4;

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
          if (d.kind === 'knowledge') return 28;
          if (scaleByUsage) {
            if (d.kind === 'character') {
              const t = charRange > 0 ? ((d.usageCount ?? 1) - minCharUsage) / charRange : 0;
              return (CHAR_MIN_R + (CHAR_MAX_R - CHAR_MIN_R) * t) + 16;
            }
            const t = locRange > 0 ? ((d.usageCount ?? 1) - minLocUsage) / locRange : 0;
            const s = LOC_MIN_SCALE + (LOC_MAX_SCALE - LOC_MIN_SCALE) * t;
            return (LOCATION_SIZE * s) / 2 + 16;
          }
          if (d.kind === 'character') return (ROLE_RADIUS[d.role ?? 'recurring'] ?? 18) + 20;
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
      .on('mouseenter', (event, d) => {
        if ((d.kind === 'character' || d.kind === 'location') && d.imagePrompt) {
          const rect = svgRef.current?.getBoundingClientRect();
          if (!rect) return;
          setNodeTooltip({ x: event.clientX - rect.left, y: event.clientY - rect.top - 10, label: d.label, kind: d.kind, imagePrompt: d.imagePrompt });
        }
      })
      .on('mouseleave', () => setNodeTooltip(null))
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

    // Character circles
    nodeGroup
      .filter((d) => d.kind === 'character')
      .append('circle')
      .attr('r', (d) => {
        if (scaleByUsage) return CHAR_MIN_R + (CHAR_MAX_R - CHAR_MIN_R) * normChar(d);
        return ROLE_RADIUS[d.role ?? 'recurring'];
      })
      .attr('fill', (d) =>
        showHeatmap ? heatColor(normChar(d)) : ROLE_FILL[d.role ?? 'recurring'],
      );

    // Location rounded rects
    nodeGroup
      .filter((d) => d.kind === 'location')
      .each(function (d) {
        const sel = d3.select(this);
        const scale = scaleByUsage
          ? LOC_MIN_SCALE + (LOC_MAX_SCALE - LOC_MIN_SCALE) * normLoc(d)
          : 1;
        const size = LOCATION_SIZE * scale;
        sel.append('rect')
          .attr('x', -size / 2)
          .attr('y', -size / 2)
          .attr('width', size)
          .attr('height', size)
          .attr('rx', LOCATION_RX)
          .attr('fill', showHeatmap ? heatColor(normLoc(d)) : LOCATION_FILL);
      });

    // ── Node images (clip-masked portraits & location photos) ──────────
    nodeGroup
      .filter((d) => d.kind === 'character' && !!d.imageUrl)
      .each(function (d) {
        const sel = d3.select(this);
        const r = scaleByUsage
          ? CHAR_MIN_R + (CHAR_MAX_R - CHAR_MIN_R) * normChar(d)
          : ROLE_RADIUS[d.role ?? 'recurring'];
        const clipId = `clip-${d.id}`;
        defs.append('clipPath').attr('id', clipId)
          .append('circle').attr('r', r);
        sel.append('image')
          .attr('href', d.imageUrl!)
          .attr('x', -r).attr('y', -r)
          .attr('width', r * 2).attr('height', r * 2)
          .attr('preserveAspectRatio', 'xMidYMid slice')
          .attr('clip-path', `url(#${clipId})`);
      });

    nodeGroup
      .filter((d) => d.kind === 'location' && !!d.imageUrl)
      .each(function (d) {
        const sel = d3.select(this);
        const scale = scaleByUsage
          ? LOC_MIN_SCALE + (LOC_MAX_SCALE - LOC_MIN_SCALE) * normLoc(d)
          : 1;
        const size = LOCATION_SIZE * scale;
        const clipId = `clip-${d.id}`;
        defs.append('clipPath').attr('id', clipId)
          .append('rect')
          .attr('x', -size / 2).attr('y', -size / 2)
          .attr('width', size).attr('height', size)
          .attr('rx', LOCATION_RX);
        sel.append('image')
          .attr('href', d.imageUrl!)
          .attr('x', -size / 2).attr('y', -size / 2)
          .attr('width', size).attr('height', size)
          .attr('preserveAspectRatio', 'xMidYMid slice')
          .attr('clip-path', `url(#${clipId})`);
      });

    // Knowledge nodes
    nodeGroup
      .filter((d) => d.kind === 'knowledge')
      .append('circle')
      .attr('r', 8)
      .attr('fill', (d) => CONTINUITY_FILL[d.continuityType ?? 'knows'] ?? DEFAULT_CONTINUITY_FILL)
      .attr('opacity', (d) => KNOWLEDGE_OPACITY[d.continuityType ?? 'knows'] ?? DEFAULT_KNOWLEDGE_OPACITY);

    // Character / location labels
    nodeGroup
      .filter((d) => d.kind !== 'knowledge')
      .append('text')
      .attr('class', 'graph-label')
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => {
        if (d.kind === 'character') {
          const r = CHAR_MIN_R + (CHAR_MAX_R - CHAR_MIN_R) * normChar(d);
          return r + 14;
        }
        const s = LOC_MIN_SCALE + (LOC_MAX_SCALE - LOC_MIN_SCALE) * normLoc(d);
        return (LOCATION_SIZE * s) / 2 + 14;
      })
      .text((d) => d.label);

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
  }, [narrative, activeArcId, graphViewMode, currentWorldBuildId, showHeatmap]);

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
    g.select('.continuity-hull').remove();

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

    const eid = entity.id;
    const parentNode = baseNodes.find((n) => n.id === eid);
    if (!parentNode) return;

    // Filter knowledge nodes to only those active at current scene
    const filteredKgNodes = getContinuityNodesAtScene(
      entity.continuity.nodes,
      eid,
      narrative.scenes,
      resolvedSceneKeys,
      state.currentSceneIndex,
    );
    const visibleContinuityNodes = filteredKgNodes.slice(-GRAPH_CONTINUITY_LIMIT);

    // Create knowledge nodes
    const continuityNodes: GraphNode[] = visibleContinuityNodes.map((kn) => ({
      id: `k-${eid}-${kn.id}`,
      kind: 'knowledge' as NodeKind,
      label: kn.content,
      continuityType: kn.type,
      parentCharacterId: eid,
      x: (parentNode.x ?? 0) + (Math.random() - 0.5) * 60,
      y: (parentNode.y ?? 0) + (Math.random() - 0.5) * 60,
    }));

    const allNodes = [...baseNodes, ...continuityNodes];
    nodesRef.current = allNodes;

    // Create knowledge links — each node connects directly to its parent entity
    const continuityLinks: GraphLink[] = [];

    for (const kn of visibleContinuityNodes) {
      const target = continuityNodes.find((n) => n.id === `k-${eid}-${kn.id}`);
      if (target) {
        continuityLinks.push({
          id: `klink-${eid}-${kn.id}`,
          source: parentNode,
          target,
          linkKind: 'knowledge',
        });
      }
    }

    // Add knowledge link elements
    const linksGroup = g.select<SVGGElement>('g.links');
    const continuityLinkEls = linksGroup
      .selectAll<SVGLineElement, GraphLink>('line.continuity')
      .data(continuityLinks, (d) => d.id)
      .join('line')
      .attr('class', 'graph-edge knowledge')
      .attr('stroke', 'rgba(255, 255, 255, 0.35)')
      .attr('stroke-opacity', 0.5)
      .attr('stroke-width', 1);

    // Add knowledge node elements
    const nodesGroup = g.select<SVGGElement>('g.nodes');
    const continuityNodeEls = nodesGroup
      .selectAll<SVGGElement, GraphNode>('g.continuity-node')
      .data(continuityNodes, (d) => d.id)
      .join('g')
      .attr('class', 'graph-node knowledge-node');

    continuityNodeEls
      .append('circle')
      .attr('r', 8)
      .attr('fill', (d) => CONTINUITY_FILL[d.continuityType ?? 'knows'] ?? DEFAULT_CONTINUITY_FILL)
      .attr('opacity', (d) => KNOWLEDGE_OPACITY[d.continuityType ?? 'knows'] ?? DEFAULT_KNOWLEDGE_OPACITY);

    continuityNodeEls
      .append('text')
      .attr('class', 'graph-label')
      .attr('text-anchor', 'middle')
      .attr('dy', 18)
      .style('font-size', '8px')
      .style('fill', '#666666')
      .text((d) => d.label);

    // Add curved convex hull "net" behind knowledge subgraph
    const hullPadding = 30;
    const hullAllNodes = [parentNode, ...continuityNodes];
    const hullPath = g.insert('path', 'g.links')
      .attr('class', 'continuity-hull')
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
      .links([...baseLinks, ...continuityLinks]);
    simulation.alpha(0.5).restart();

    // Tick handler for knowledge elements
    simulation.on('tick.continuity', () => {
      continuityLinkEls
        .attr('x1', (d) => ((d.source as GraphNode).x ?? 0))
        .attr('y1', (d) => ((d.source as GraphNode).y ?? 0))
        .attr('x2', (d) => ((d.target as GraphNode).x ?? 0))
        .attr('y2', (d) => ((d.target as GraphNode).y ?? 0));

      continuityNodeEls.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);

      updateHull();
    });
  }, [selectedKnowledgeEntity, narrative, resolvedSceneKeys, state.currentSceneIndex]);

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

  // ── Zoom to focused group ──
  useEffect(() => {
    const svg = svgRef.current;
    const zoom = zoomRef.current;
    if (!svg || !zoom || focusedGroupIndex === null || !groups[focusedGroupIndex]) return;

    const group = groups[focusedGroupIndex];
    const width = svg.clientWidth || 800;
    const height = svg.clientHeight || 600;

    // Compute bounding box of group nodes
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of group) {
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    const padding = 80;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    const bw = maxX - minX;
    const bh = maxY - minY;
    const scale = Math.min(width / bw, height / bh, 2);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const transform = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(scale)
      .translate(-cx, -cy);

    d3.select(svg)
      .transition()
      .duration(500)
      .call(zoom.transform as unknown as (t: d3.Transition<SVGSVGElement, unknown, null, undefined>) => void, transform);
  }, [focusedGroupIndex, groups]);

  const navigateGroup = useCallback(
    (direction: 'next' | 'prev' | 'reset') => {
      if (groups.length === 0) return;
      if (direction === 'reset') {
        setFocusedGroupIndex(null);
        // Reset zoom
        const svg = svgRef.current;
        const zoom = zoomRef.current;
        if (svg && zoom) {
          d3.select(svg)
            .transition()
            .duration(500)
            .call(zoom.transform as unknown as (t: d3.Transition<SVGSVGElement, unknown, null, undefined>) => void, d3.zoomIdentity);
        }
        return;
      }
      setFocusedGroupIndex((prev) => {
        if (prev === null) return 0;
        if (direction === 'next') return (prev + 1) % groups.length;
        return (prev - 1 + groups.length) % groups.length;
      });
    },
    [groups],
  );

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
      {/* Controls (top-left) — contextual per graph view mode */}
      {(graphViewMode === 'spatial' || graphViewMode === 'overview') && <div className="absolute top-2 left-2 z-10 flex flex-col gap-1">
        {showHeatmap && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-bg-surface text-[10px] leading-none text-text-dim">
            <span>Low</span>
            <div
              className="h-2 w-20 rounded-sm"
              style={{
                background: 'linear-gradient(to right, #3B82F6, #22C55E, #EF4444)',
              }}
            />
            <span>High</span>
          </div>
        )}
        <div className="flex items-center gap-0">
          <label className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-bg-surface text-[11px] leading-none text-text-dim hover:text-text-default cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showEdgeLabels}
              onChange={() => setShowEdgeLabels((v) => !v)}
              className="accent-accent-cta w-3 h-3"
            />
            Labels
          </label>
          <label className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-bg-surface text-[11px] leading-none text-text-dim hover:text-text-default cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showHeatmap}
              onChange={() => setShowHeatmap((v) => !v)}
              className="accent-accent-cta w-3 h-3"
            />
            Heat
          </label>
          <label className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-bg-surface text-[11px] leading-none text-text-dim hover:text-text-default cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showEval}
              onChange={() => setShowEval((v) => !v)}
              className="accent-accent-cta w-3 h-3"
            />
            Eval
          </label>
        </div>
      </div>}
      {showEval && <EvalBar />}
      {/* Graph view mode toggle (top-right) */}
      <div className="absolute top-2 right-2 z-30 flex items-center rounded bg-bg-surface text-[11px] leading-none">
        {([
          { mode: 'spatial' as const, label: 'Spatial' },
          { mode: 'overview' as const, label: 'World' },
          { mode: 'prose' as const, label: 'Prose' },
          { mode: 'spark' as const, label: 'Spark' },
          { mode: 'codex' as const, label: 'Codex' },
        ]).map(({ mode, label }, i, arr) => (
          <span key={mode} className="contents">
            {i > 0 && <div className="w-px h-3.5 bg-border" />}
            <button
              className={`px-2 py-1.5 ${i === 0 ? 'rounded-l' : ''} ${i === arr.length - 1 ? 'rounded-r' : ''} transition-colors ${
                graphViewMode === mode ? 'text-accent-cta' : 'text-text-dim hover:text-text-default'
              }`}
              onClick={() => dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode })}
            >
              {label}
            </button>
          </span>
        ))}
      </div>
      {graphViewMode === 'prose' ? (
        <div className="absolute inset-0 z-20 overflow-y-auto flex justify-center" style={{ scrollbarWidth: 'thin' }}>
          <div className="max-w-xl w-full">
            {currentScene?.prose ? (
              <div className="text-[15px] py-24 text-text-secondary/90 leading-[1.9] whitespace-pre-wrap font-serif">
                {currentScene.prose}
              </div>
            ) : (
              <p className="text-text-dim text-sm italic">
                {currentScene ? 'No prose available for this scene.' : 'No scene selected.'}
              </p>
            )}
          </div>
        </div>
      ) : graphViewMode === 'spark' || graphViewMode === 'codex' ? (
        <KnowledgeGraphView
          narrative={narrative!}
          resolvedKeys={state.resolvedSceneKeys}
          currentIndex={state.currentSceneIndex}
          mode={graphViewMode}
        />
      ) : (
        <svg
          ref={svgRef}
          className="h-full w-full"
          style={{ background: 'transparent' }}
        />
      )}
      {/* Group navigation (bottom-left) */}
      {graphViewMode !== 'prose' && groups.length > 1 && (
        <div className="absolute bottom-4 left-2 z-10 flex items-center gap-1 rounded bg-bg-surface text-[11px] leading-none">
          <button
            className="px-1.5 py-1.5 text-text-dim hover:text-text-default transition-colors"
            onClick={() => navigateGroup('prev')}
            title="Previous group"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <span className="text-text-dim px-0.5 tabular-nums">
            {focusedGroupIndex !== null
              ? `${focusedGroupIndex + 1}/${groups.length} (${groups[focusedGroupIndex].length})`
              : `${groups.length} groups`}
          </span>
          <button
            className="px-1.5 py-1.5 text-text-dim hover:text-text-default transition-colors"
            onClick={() => navigateGroup('next')}
            title="Next group"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
          </button>
          {focusedGroupIndex !== null && (
            <>
              <div className="w-px h-3.5 bg-border" />
              <button
                className="px-1.5 py-1.5 text-text-dim hover:text-text-default transition-colors"
                onClick={() => navigateGroup('reset')}
                title="Reset view"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
              </button>
            </>
          )}
        </div>
      )}
      {/* Fullscreen toggle */}
      <FullscreenButton />
      {/* Character/location image prompt tooltip */}
      {nodeTooltip && (
        <div
          className="absolute z-40 pointer-events-none"
          style={{ left: nodeTooltip.x, top: nodeTooltip.y - 12, transform: 'translate(-50%, -100%)' }}
        >
          <div className="bg-bg-elevated border border-border rounded-lg px-3 py-2 shadow-xl w-72">
            <div className="text-xs font-semibold text-text-primary mb-1">{nodeTooltip.label}</div>
            <div className="text-[10px] text-text-dim leading-relaxed">{nodeTooltip.imagePrompt}</div>
          </div>
          <div className="flex justify-center"><div className="w-2.5 h-2.5 bg-bg-elevated border-r border-b border-border rotate-45 -mt-1.5" /></div>
        </div>
      )}
    </div>
  );
}
