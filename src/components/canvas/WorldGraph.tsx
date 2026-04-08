'use client';

import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import * as d3 from 'd3';
import { useStore } from '@/lib/store';
import { GRAPH_CONTINUITY_LIMIT } from '@/lib/constants';
import { getContinuityNodesAtScene, getContinuityEdgesAtScene, getRelationshipsAtScene, getIntroducedIds } from '@/lib/scene-filter';
import type {
  Character,
  Location,
  RelationshipEdge,
  GraphViewMode,
} from '@/types/narrative';
import EvalBar from '@/components/timeline/EvalBar';
import KnowledgeGraphView, { FullscreenButton } from './KnowledgeGraphView';
import ContinuityGraphView from './ContinuityGraphView';
import ThreadGraphView from './ThreadGraphView';
import { ScenePlanView } from './ScenePlanView';
import { SceneProseView } from './SceneProseView';
import { SceneAudioView } from './SceneAudioView';
import { SearchView } from './SearchView';
import {
  type GraphNode,
  type GraphLink,
  type NodeKind,
  computeGroups,
  computeCharacterPositions,
  buildGraphData,
  buildOverviewGraphData,
  heatColor,
  ROLE_RADIUS,
  ROLE_FILL,
  LOCATION_SIZE,
  LOCATION_RX,
  LOCATION_FILL,
  CONTINUITY_FILL,
  KNOWLEDGE_OPACITY,
  DEFAULT_CONTINUITY_FILL,
  DEFAULT_KNOWLEDGE_OPACITY,
} from './graph-utils';
import { useImageUrlMap } from '@/hooks/useAssetUrl';

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
  const [showItems, setShowItems] = useState(false);
  const [showEval, setShowEval] = useState(true);
  const [groups, setGroups] = useState<GraphNode[][]>([]);
  const [focusedGroupIndex, setFocusedGroupIndex] = useState<number | null>(null);
  const [nodeTooltip, setNodeTooltip] = useState<{ x: number; y: number; label: string; kind: string; imagePrompt: string } | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  const narrative = state.activeNarrative;
  const inspectorContext = state.inspectorContext;
  const selectedKnowledgeEntity = state.selectedKnowledgeEntity;
  const graphViewMode = state.graphViewMode;
  const [sceneFocus, setSceneFocus] = useState(true);

  const resolvedEntryKeys = state.resolvedEntryKeys;

  const currentSceneKey = resolvedEntryKeys[state.currentSceneIndex] ?? null;

  const activeArcId = useMemo(() => {
    if (!narrative || !currentSceneKey) return null;
    return Object.values(narrative.arcs).find((a) => a.sceneIds.includes(currentSceneKey))?.id ?? null;
  }, [narrative, currentSceneKey]);

  const currentScene = useMemo(() => {
    if (!narrative || !currentSceneKey) return null;
    return narrative.scenes[currentSceneKey] ?? null;
  }, [narrative, currentSceneKey]);

  // Collect all image refs from entities for batch resolution
  const allImageRefs = useMemo(() => {
    if (!narrative) return [];
    const refs: string[] = [];
    for (const char of Object.values(narrative.characters)) {
      if (char.imageUrl) refs.push(char.imageUrl);
    }
    for (const loc of Object.values(narrative.locations)) {
      if (loc.imageUrl) refs.push(loc.imageUrl);
    }
    for (const art of Object.values(narrative.artifacts ?? {})) {
      if (art.imageUrl) refs.push(art.imageUrl);
    }
    return refs;
  }, [narrative]);

  // Resolve all image refs to blob URLs
  const resolvedImageUrls = useImageUrlMap(allImageRefs);

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
      setNodeTooltip(null);
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
      setNodeTooltip(null);
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
    const key = resolvedEntryKeys[state.currentSceneIndex];
    return key && narrative.worldBuilds[key] ? key : null;
  }, [narrative, resolvedEntryKeys, state.currentSceneIndex]);

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

    // Filter artifacts to only those introduced by the current timeline position
    const introduced = getIntroducedIds(narrative.worldBuilds, resolvedEntryKeys, state.currentSceneIndex);
    const visibleArtifacts = showItems
      ? Object.fromEntries(Object.entries(narrative.artifacts ?? {}).filter(([id]) => introduced.artifactIds.has(id)))
      : {};

    if (graphViewMode === 'overview') {
      // Overview mode: all characters/locations sized by usage
      const result = buildOverviewGraphData(
        narrative.characters,
        narrative.locations,
        narrative.relationships,
        narrative.scenes,
        narrative.worldBuilds,
        resolvedEntryKeys,
        resolvedEntryKeys.length - 1,
        visibleArtifacts,
      );
      nodes = result.nodes;
      links = result.links;
    } else {
      // Check if current scene is a world expansion
      const currentKey = resolvedEntryKeys[state.currentSceneIndex];
      const currentWorldBuild = currentKey ? narrative.worldBuilds[currentKey] : null;

      if (currentWorldBuild) {
        // Expansion mode: show expansion elements + connected existing entities
        const manifest = currentWorldBuild.expansionManifest;
        const expandedCharIds = new Set(manifest.characters.map((c) => c.id));
        const expandedLocIds = new Set(manifest.locations.map((l) => l.id));

        // Relationships filtered to current timeline position, then to expansion entities
        const timelineRels = getRelationshipsAtScene(narrative, resolvedEntryKeys, state.currentSceneIndex);
        const filteredRels = timelineRels.filter(
          (r) => expandedCharIds.has(r.from) || expandedCharIds.has(r.to),
        );

        // Collect existing character IDs that are connected via relationships
        const connectedCharIds = new Set(expandedCharIds);
        for (const rel of filteredRels) {
          connectedCharIds.add(rel.from);
          connectedCharIds.add(rel.to);
        }

        // Include characters/locations that own artifacts from this expansion
        for (const art of manifest.artifacts ?? []) {
          if (narrative.characters[art.parentId]) connectedCharIds.add(art.parentId);
          if (narrative.locations[art.parentId]) expandedLocIds.add(art.parentId);
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
          visibleArtifacts,
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
          resolvedEntryKeys,
          state.currentSceneIndex,
        );

        if (sceneFocus && currentScene && activeArc) {
          // Scene focus: show scene location + POV character's location (if different)
          // and all characters at either location
          const charPositions = computeCharacterPositions(activeArc, narrative.scenes, state.currentSceneIndex, resolvedEntryKeys);

          const sceneLocId = currentScene.locationId;
          const povLocId = charPositions[currentScene.povId] ?? sceneLocId;
          const focusLocIds = new Set([sceneLocId, povLocId]);
          // Include parent locations for hierarchy context
          for (const locId of [...focusLocIds]) {
            const loc = narrative.locations[locId];
            if (loc?.parentId) focusLocIds.add(loc.parentId);
          }

          // Characters: scene participants + anyone positioned at either location
          const focusCharIds = new Set([currentScene.povId, ...currentScene.participantIds]);
          for (const [charId, locId] of Object.entries(charPositions)) {
            if (focusLocIds.has(locId)) focusCharIds.add(charId);
          }

          filteredCharacters = Object.fromEntries(
            Object.entries(narrative.characters).filter(([id]) => focusCharIds.has(id)),
          );
          filteredLocations = Object.fromEntries(
            Object.entries(narrative.locations).filter(([id]) => focusLocIds.has(id)),
          );
          filteredRelationships = sceneRelationships.filter(
            (r) => focusCharIds.has(r.from) && focusCharIds.has(r.to),
          );
        } else if (activeArc) {
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
          ? computeCharacterPositions(activeArc, narrative.scenes, state.currentSceneIndex, resolvedEntryKeys)
          : {};

        const result = buildGraphData(
          filteredCharacters,
          filteredLocations,
          filteredRelationships,
          characterPositions,
          visibleArtifacts,
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

    // Zoom behavior
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        g.attr('transform', event.transform.toString());
      });

    svg.call(zoom);
    zoomRef.current = zoom;
    svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(0.9));

    // Click on empty canvas → revert inspector to current scene
    svg.on('click', (event: MouseEvent) => {
      // Only fire when clicking the SVG background, not a node
      if (event.target === svgRef.current) {
        const currentKey = resolvedEntryKeys[state.currentSceneIndex];
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
      .force('center', d3.forceCenter(0, 0))
      .force('x', d3.forceX(0).strength(0.05))
      .force('y', d3.forceY(0).strength(0.05))
      .force(
        'collide',
        d3.forceCollide<GraphNode>().radius((d) => {
          if (d.kind === 'knowledge') return 28;
          if (d.kind === 'artifact') return (d.significance === 'key' ? 14 : d.significance === 'minor' ? 7 : 10) + 14;
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
        if (d.kind === 'artifact') {
          setNodeTooltip(null);
          dispatch({ type: 'SELECT_KNOWLEDGE_ENTITY', entityId: selectedKnowledgeEntity === d.id ? null : d.id });
          dispatch({ type: 'SET_INSPECTOR', context: { type: 'artifact', artifactId: d.id } });
        }
      })
      .on('mouseenter', (event, d) => {
        if ((d.kind === 'character' || d.kind === 'location' || d.kind === 'artifact') && d.imagePrompt) {
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
    // Use resolved blob URLs from the map (asset IDs like "img_abc123" → blob URLs)
    nodeGroup
      .filter((d) => d.kind === 'character' && !!d.imageUrl && resolvedImageUrls.has(d.imageUrl))
      .each(function (d) {
        const sel = d3.select(this);
        const r = scaleByUsage
          ? CHAR_MIN_R + (CHAR_MAX_R - CHAR_MIN_R) * normChar(d)
          : ROLE_RADIUS[d.role ?? 'recurring'];
        const clipId = `clip-${d.id}`;
        defs.append('clipPath').attr('id', clipId)
          .append('circle').attr('r', r);
        sel.append('image')
          .attr('href', resolvedImageUrls.get(d.imageUrl!)!)
          .attr('x', -r).attr('y', -r)
          .attr('width', r * 2).attr('height', r * 2)
          .attr('preserveAspectRatio', 'xMidYMid slice')
          .attr('clip-path', `url(#${clipId})`);
      });

    nodeGroup
      .filter((d) => d.kind === 'location' && !!d.imageUrl && resolvedImageUrls.has(d.imageUrl))
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
          .attr('href', resolvedImageUrls.get(d.imageUrl!)!)
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
      .attr('fill', (d) => CONTINUITY_FILL[d.continuityType ?? 'trait'] ?? DEFAULT_CONTINUITY_FILL)
      .attr('opacity', (d) => KNOWLEDGE_OPACITY[d.continuityType ?? 'trait'] ?? DEFAULT_KNOWLEDGE_OPACITY);

    // Artifact diamonds — sized by significance
    const ARTIFACT_SIZES: Record<string, number> = { key: 14, notable: 10, minor: 7 };
    const ARTIFACT_FILLS: Record<string, string> = { key: '#F59E0B', notable: '#D97706', minor: '#92400E' };
    nodeGroup
      .filter((d) => d.kind === 'artifact')
      .append('rect')
      .attr('x', (d) => -(ARTIFACT_SIZES[d.significance ?? 'notable'] ?? 10))
      .attr('y', (d) => -(ARTIFACT_SIZES[d.significance ?? 'notable'] ?? 10))
      .attr('width', (d) => (ARTIFACT_SIZES[d.significance ?? 'notable'] ?? 10) * 2)
      .attr('height', (d) => (ARTIFACT_SIZES[d.significance ?? 'notable'] ?? 10) * 2)
      .attr('rx', 2)
      .attr('transform', 'rotate(45)')
      .attr('fill', (d) => ARTIFACT_FILLS[d.significance ?? 'notable'] ?? '#D97706')
      .attr('opacity', 0.85);

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
        if (d.kind === 'artifact') {
          const sz = ARTIFACT_SIZES[d.significance ?? 'notable'] ?? 10;
          return sz + 18;
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
  }, [narrative, activeArcId, graphViewMode, currentWorldBuildId, showHeatmap, sceneFocus, showItems, currentScene, resolvedImageUrls.size]);

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

    // Show/hide base world elements based on entity focus
    g.selectAll('g.graph-node:not(.knowledge-node)').attr('visibility', selectedKnowledgeEntity ? 'hidden' : 'visible');
    g.selectAll('line.graph-edge:not(.knowledge):not(.continuity-edge)').attr('visibility', selectedKnowledgeEntity ? 'hidden' : 'visible');
    g.selectAll('text.edge-label').attr('visibility', selectedKnowledgeEntity ? 'hidden' : 'visible');

    if (!selectedKnowledgeEntity) {
      nodesRef.current = baseNodes;
      simulation.nodes(baseNodes);
      (simulation.force('link') as d3.ForceLink<GraphNode, GraphLink>).links(baseLinks);
      simulation.force('hull-repulsion', null);
      simulation.alpha(0.1).restart();
      return;
    }

    const entity = narrative.characters[selectedKnowledgeEntity] ?? narrative.locations[selectedKnowledgeEntity] ?? narrative.artifacts[selectedKnowledgeEntity];
    if (!entity) return;

    const eid = entity.id;
    const parentNode = baseNodes.find((n) => n.id === eid);
    if (!parentNode) return;

    // Filter knowledge nodes to only those active at current scene
    const filteredKgNodes = getContinuityNodesAtScene(
      entity.continuity.nodes,
      eid,
      narrative.scenes,
      resolvedEntryKeys,
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

    // Focused view: only show the parent entity + its knowledge nodes
    const allNodes = [parentNode, ...continuityNodes];
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

    // Create continuity edge links between knowledge nodes (inner-world edges)
    const visibleNodeIds = new Set(visibleContinuityNodes.map(n => n.id));
    const continuityEdges = getContinuityEdgesAtScene(
      entity.continuity.edges,
      eid,
      narrative.scenes,
      resolvedEntryKeys,
      state.currentSceneIndex,
      entity.continuity.nodes,
    );
    const edgeLinks: (GraphLink & { edgeRelation?: string })[] = [];
    for (const edge of continuityEdges) {
      if (!visibleNodeIds.has(edge.from) || !visibleNodeIds.has(edge.to)) continue;
      const source = continuityNodes.find(n => n.id === `k-${eid}-${edge.from}`);
      const target = continuityNodes.find(n => n.id === `k-${eid}-${edge.to}`);
      if (source && target) {
        edgeLinks.push({
          id: `kedge-${eid}-${edge.from}-${edge.to}-${edge.relation}`,
          source,
          target,
          linkKind: 'knowledge',
          edgeRelation: edge.relation,
        });
      }
    }

    // Add knowledge link elements (parent→node + node→node edges)
    const linksGroup = g.select<SVGGElement>('g.links');
    const allContinuityLinks = [...continuityLinks, ...edgeLinks];
    const continuityLinkEls = linksGroup
      .selectAll<SVGLineElement, GraphLink>('line.continuity')
      .data(continuityLinks, (d) => d.id)
      .join('line')
      .attr('class', 'graph-edge knowledge')
      .attr('stroke', 'rgba(255, 255, 255, 0.35)')
      .attr('stroke-opacity', 0.5)
      .attr('stroke-width', 1);

    // Render continuity edges (node→node) with colored lines and optional labels
    const edgeLinkEls = linksGroup
      .selectAll<SVGLineElement, GraphLink>('line.continuity-edge')
      .data(edgeLinks, (d) => d.id)
      .join('line')
      .attr('class', 'graph-edge continuity-edge')
      .attr('stroke', 'rgba(168, 85, 247, 0.6)')
      .attr('stroke-opacity', 0.7)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4 2');

    // Edge relation labels
    const edgeLabelEls = linksGroup
      .selectAll<SVGTextElement, typeof edgeLinks[0]>('text.continuity-edge-label')
      .data(showEdgeLabels ? edgeLinks : [], (d) => d.id)
      .join('text')
      .attr('class', 'continuity-edge-label')
      .style('font-size', '7px')
      .style('fill', 'rgba(168, 85, 247, 0.8)')
      .text((d) => (d as { edgeRelation?: string }).edgeRelation ?? '');

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
      .attr('fill', (d) => CONTINUITY_FILL[d.continuityType ?? 'trait'] ?? DEFAULT_CONTINUITY_FILL)
      .attr('opacity', (d) => KNOWLEDGE_OPACITY[d.continuityType ?? 'trait'] ?? DEFAULT_KNOWLEDGE_OPACITY);

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

    // Update simulation — focused view uses only continuity links (no world links)
    simulation.nodes(allNodes);
    (simulation.force('link') as d3.ForceLink<GraphNode, GraphLink>)
      .links(allContinuityLinks);
    simulation.alpha(0.5).restart();

    // Tick handler for knowledge elements
    simulation.on('tick.continuity', () => {
      continuityLinkEls
        .attr('x1', (d) => ((d.source as GraphNode).x ?? 0))
        .attr('y1', (d) => ((d.source as GraphNode).y ?? 0))
        .attr('x2', (d) => ((d.target as GraphNode).x ?? 0))
        .attr('y2', (d) => ((d.target as GraphNode).y ?? 0));

      edgeLinkEls
        .attr('x1', (d) => ((d.source as GraphNode).x ?? 0))
        .attr('y1', (d) => ((d.source as GraphNode).y ?? 0))
        .attr('x2', (d) => ((d.target as GraphNode).x ?? 0))
        .attr('y2', (d) => ((d.target as GraphNode).y ?? 0));

      edgeLabelEls
        .attr('x', (d) => (((d.source as GraphNode).x ?? 0) + ((d.target as GraphNode).x ?? 0)) / 2)
        .attr('y', (d) => (((d.source as GraphNode).y ?? 0) + ((d.target as GraphNode).y ?? 0)) / 2 - 3);

      continuityNodeEls.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);

      updateHull();
    });
  }, [selectedKnowledgeEntity, narrative, resolvedEntryKeys, state.currentSceneIndex]);

  // ── Lightweight intra-arc update: character-location links on scene change ──
  useEffect(() => {
    const g = gRef.current;
    const simulation = simulationRef.current;
    if (!g || !simulation || !narrative || !activeArcId) return;

    const activeArc = narrative.arcs[activeArcId];
    if (!activeArc) return;

    const positions = computeCharacterPositions(activeArc, narrative.scenes, state.currentSceneIndex, resolvedEntryKeys);

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
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Legend strip — only for spatial/overview when NOT viewing an entity's inner graph */}
      {(graphViewMode === 'spatial' || graphViewMode === 'overview') && !selectedKnowledgeEntity && (
        <div className="shrink-0 flex items-center gap-0 px-2 h-7 border-b border-border bg-bg-base/60">
          {([
            { key: 'labels', label: 'Labels', checked: showEdgeLabels, toggle: () => setShowEdgeLabels((v) => !v) },
            { key: 'heat', label: 'Heat', checked: showHeatmap, toggle: () => setShowHeatmap((v) => !v) },
            { key: 'eval', label: 'Eval', checked: showEval, toggle: () => setShowEval((v) => !v) },
            ...(graphViewMode === 'spatial' ? [{ key: 'focus', label: 'Focus', checked: sceneFocus, toggle: () => setSceneFocus((v: boolean) => !v) }] : []),
            { key: 'items', label: 'Items', checked: showItems, toggle: () => setShowItems((v) => !v) },
          ] as { key: string; label: string; checked: boolean; toggle: () => void }[]).map(({ key, label, checked, toggle }) => (
            <button
              key={key}
              onClick={toggle}
              className={`text-[9px] px-2 py-1 rounded transition-colors select-none ${
                checked ? 'text-text-secondary' : 'text-text-dim/40 hover:text-text-dim'
              }`}
            >
              {label}
            </button>
          ))}
          {showHeatmap && (
            <>
              <div className="w-px h-3 bg-border mx-1" />
              <div className="flex items-center gap-1">
                <span className="text-[8px] text-text-dim/40">Low</span>
                <div className="h-1.5 w-12 rounded-full" style={{ background: 'linear-gradient(to right, #3B82F6, #22C55E, #EF4444)' }} />
                <span className="text-[8px] text-text-dim/40">High</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Canvas area */}
      <div className="relative flex-1 overflow-hidden">
      {showEval && (graphViewMode === 'spatial' || graphViewMode === 'overview') && <EvalBar />}
      {graphViewMode === 'plan' ? (
        currentScene ? (
          <ScenePlanView narrative={narrative} scene={currentScene} resolvedKeys={resolvedEntryKeys} />
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-text-dim text-sm italic">No scene selected.</p>
          </div>
        )
      ) : graphViewMode === 'prose' ? (
        currentScene ? (
          <SceneProseView narrative={narrative} scene={currentScene} resolvedKeys={resolvedEntryKeys} />
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-text-dim text-sm italic">No scene selected.</p>
          </div>
        )
      ) : graphViewMode === 'audio' ? (
        currentScene ? (
          <SceneAudioView narrative={narrative} scene={currentScene} />
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-text-dim text-sm italic">No scene selected.</p>
          </div>
        )
      ) : graphViewMode === 'pulse' || graphViewMode === 'threads' ? (
        <ThreadGraphView
          narrative={narrative!}
          resolvedKeys={state.resolvedEntryKeys}
          currentIndex={state.currentSceneIndex}
          mode={graphViewMode as 'pulse' | 'threads'}
          onSelectThread={(id) => dispatch({ type: 'SET_INSPECTOR', context: { type: 'thread', threadId: id } })}
          hideControls hideLegend
        />
      ) : graphViewMode === 'search' ? (
        <SearchView />
      ) : graphViewMode === 'spark' || graphViewMode === 'codex' ? (
        <KnowledgeGraphView
          narrative={narrative!}
          resolvedKeys={state.resolvedEntryKeys}
          currentIndex={state.currentSceneIndex}
          mode={graphViewMode}
          hideControls hideLegend
        />
      ) : selectedKnowledgeEntity ? (
        <ContinuityGraphView
          entityId={selectedKnowledgeEntity}
          entityName={(narrative.characters[selectedKnowledgeEntity] ?? narrative.locations[selectedKnowledgeEntity] ?? narrative.artifacts[selectedKnowledgeEntity])?.name ?? selectedKnowledgeEntity}
          continuity={(narrative.characters[selectedKnowledgeEntity] ?? narrative.locations[selectedKnowledgeEntity] ?? narrative.artifacts[selectedKnowledgeEntity])?.continuity ?? { nodes: {}, edges: [] }}
          scenes={narrative.scenes}
          resolvedKeys={resolvedEntryKeys}
          currentIndex={state.currentSceneIndex}
        />
      ) : (
        <svg
          ref={svgRef}
          className="h-full w-full"
          style={{ background: 'transparent' }}
        />
      )}
      {/* Group navigation (bottom-left) */}
      {(graphViewMode === 'spatial' || graphViewMode === 'overview') && groups.length > 1 && (
        <div className="absolute bottom-4 left-2 z-10">
        <div className="flex items-center gap-1 rounded bg-bg-surface text-[11px] leading-none">
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
      </div>
      )}
      {/* Fullscreen toggle */}
      <FullscreenButton />
      {/* Character/location image prompt tooltip — hidden when viewing entity inner graph */}
      {nodeTooltip && !selectedKnowledgeEntity && (
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
    </div>
  );
}
