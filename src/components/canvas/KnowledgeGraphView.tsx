'use client';

import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import * as d3 from 'd3';
import { useStore } from '@/lib/store';
import { buildCumulativeWorldKnowledge } from '@/lib/narrative-utils';
import type { NarrativeState } from '@/types/narrative';
import EvalBar from '@/components/timeline/EvalBar';
import { computeGroups, WK_TYPE_COLORS, type WKNode, type WKLink } from './graph-utils';

// ── Fullscreen button ────────────────────────────────────────────────────────

export function FullscreenButton() {
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

// ── Knowledge Graph Views (Insight + Nexus) ─────────────────────────────────

export default function KnowledgeGraphView({ narrative, resolvedKeys, currentIndex, mode }: {
  narrative: NarrativeState;
  resolvedKeys: string[];
  currentIndex: number;
  mode: 'spark' | 'codex';
}) {
  const { dispatch } = useStore();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simRef = useRef<d3.Simulation<WKNode, WKLink> | null>(null);
  const gRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const nodesRef = useRef<WKNode[]>([]);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [showRelations, setShowRelations] = useState(false);
  const [showTypes, setShowTypes] = useState(true);
  const [showEval, setShowEval] = useState(true);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; concept: string; type: string; degree: number } | null>(null);
  const [wkGroups, setWkGroups] = useState<WKNode[][]>([]);
  const [wkFocusedGroupIndex, setWkFocusedGroupIndex] = useState<number | null>(null);

  const graphData = useMemo(() => {
    if (mode === 'spark') {
      const key = resolvedKeys[currentIndex];
      const scene = narrative.scenes[key];
      const wb = narrative.worldBuilds[key];
      const wkm = scene?.worldKnowledgeMutations ?? wb?.expansionManifest.worldKnowledge;
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
    return buildCumulativeWorldKnowledge(narrative.scenes, resolvedKeys, currentIndex, narrative.worldBuilds);
  }, [narrative, resolvedKeys, currentIndex, mode]);

  // Scene-added node IDs for highlight in nexus mode
  const sceneNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (mode === 'codex') {
      const key = resolvedKeys[currentIndex];
      const scene = narrative.scenes[key];
      const wb = narrative.worldBuilds[key];
      const wkm = scene?.worldKnowledgeMutations ?? wb?.expansionManifest.worldKnowledge;
      for (const n of wkm?.addedNodes ?? []) ids.add(n.id);
    }
    return ids;
  }, [narrative, resolvedKeys, currentIndex, mode]);

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
    zoomRef.current = zoom;
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
        setTooltip({ x: event.clientX - rect.left, y: event.clientY - rect.top - 10, concept: d.concept, type: d.type, degree: d.degree });
      })
      .on('mouseleave', () => setTooltip(null))
      .on('click', (_event, d) => {
        _event.stopPropagation();
        dispatch({ type: 'SET_INSPECTOR', context: { type: 'knowledge', nodeId: d.id } });
        window.dispatchEvent(new CustomEvent('focus-knowledge-node', { detail: { nodeId: d.id } }));
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
        const concept = d.concept ?? '';
        const dash = concept.indexOf(' — ');
        return dash > 0 ? concept.slice(0, dash) : concept.slice(0, 40) + (concept.length > 40 ? '…' : '');
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

    // Compute connected groups and reset focus
    setWkGroups(computeGroups(simNodes, simLinks));
    setWkFocusedGroupIndex(null);
  }, [graphData, mode, sceneNodeIds, showLabels, showRelations, showTypes]);

  // ── Zoom to focused group ──
  useEffect(() => {
    const svgEl = svgRef.current;
    const zoom = zoomRef.current;
    if (!svgEl || !zoom || wkFocusedGroupIndex === null || !wkGroups[wkFocusedGroupIndex]) return;

    const group = wkGroups[wkFocusedGroupIndex];
    const width = svgEl.clientWidth || 800;
    const height = svgEl.clientHeight || 600;

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
    minX -= padding; minY -= padding; maxX += padding; maxY += padding;
    const bw = maxX - minX;
    const bh = maxY - minY;
    const scale = Math.min(width / bw, height / bh, 2);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const transform = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(scale)
      .translate(-cx, -cy);

    d3.select(svgEl)
      .transition()
      .duration(500)
      .call(zoom.transform as unknown as (t: d3.Transition<SVGSVGElement, unknown, null, undefined>) => void, transform);
  }, [wkFocusedGroupIndex, wkGroups]);

  const navigateWkGroup = useCallback(
    (direction: 'next' | 'prev' | 'reset') => {
      if (wkGroups.length === 0) return;
      if (direction === 'reset') {
        setWkFocusedGroupIndex(null);
        const svgEl = svgRef.current;
        const zoom = zoomRef.current;
        if (svgEl && zoom) {
          const width = svgEl.clientWidth ?? 800;
          const height = svgEl.clientHeight ?? 600;
          d3.select(svgEl)
            .transition()
            .duration(500)
            .call(zoom.transform as unknown as (t: d3.Transition<SVGSVGElement, unknown, null, undefined>) => void, d3.zoomIdentity.translate(width / 2, height / 2).scale(0.9));
        }
        return;
      }
      setWkFocusedGroupIndex((prev) => {
        if (prev === null) return 0;
        if (direction === 'next') return (prev + 1) % wkGroups.length;
        return (prev - 1 + wkGroups.length) % wkGroups.length;
      });
    },
    [wkGroups],
  );

  // Listen for focus-knowledge-node events and zoom to the target
  useEffect(() => {
    const handler = (e: Event) => {
      const nodeId = (e as CustomEvent).detail?.nodeId;
      if (!nodeId) return;
      const target = nodesRef.current.find((n) => n.id === nodeId);
      const svgEl = svgRef.current;
      const zoom = zoomRef.current;
      if (!target || !svgEl || !zoom || target.x == null || target.y == null) return;
      const svg = d3.select(svgEl);
      const width = svgEl.clientWidth ?? 800;
      const height = svgEl.clientHeight ?? 600;
      const scale = 2;
      const transform = d3.zoomIdentity
        .translate(width / 2 - target.x * scale, height / 2 - target.y * scale)
        .scale(scale);
      svg.transition().duration(600).call(
        zoom.transform as unknown as (t: d3.Transition<SVGSVGElement, unknown, null, undefined>) => void,
        transform,
      );
    };
    window.addEventListener('focus-knowledge-node', handler);
    return () => window.removeEventListener('focus-knowledge-node', handler);
  }, []);

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
          </div>
          <div className="flex justify-center"><div className="w-2.5 h-2.5 bg-bg-elevated border-r border-b border-border rotate-45 -mt-1.5" /></div>
        </div>
      )}
      {/* Legend + Group navigation (bottom-left) */}
      <div className="absolute bottom-4 left-2 z-30 flex flex-col gap-1 items-start">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-bg-surface text-[10px] leading-none text-text-dim">
          {Object.entries(WK_TYPE_COLORS).map(([type, color]) => (
            <span key={type} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
              <span className="capitalize">{type}</span>
            </span>
          ))}
        </div>
        {wkGroups.length > 1 && (
        <div className="flex items-center gap-1 rounded bg-bg-surface text-[11px] leading-none">
          <button
            className="px-1.5 py-1.5 text-text-dim hover:text-text-default transition-colors"
            onClick={() => navigateWkGroup('prev')}
            title="Previous group"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <span className="text-text-dim px-0.5 tabular-nums">
            {wkFocusedGroupIndex !== null
              ? `${wkFocusedGroupIndex + 1}/${wkGroups.length} (${wkGroups[wkFocusedGroupIndex].length})`
              : `${wkGroups.length} groups`}
          </span>
          <button
            className="px-1.5 py-1.5 text-text-dim hover:text-text-default transition-colors"
            onClick={() => navigateWkGroup('next')}
            title="Next group"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
          </button>
          {wkFocusedGroupIndex !== null && (
            <>
              <div className="w-px h-3.5 bg-border" />
              <button
                className="px-1.5 py-1.5 text-text-dim hover:text-text-default transition-colors"
                onClick={() => navigateWkGroup('reset')}
                title="Reset view"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
              </button>
            </>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
