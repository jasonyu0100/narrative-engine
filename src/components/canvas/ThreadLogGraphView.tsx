'use client';

import { useRef, useEffect, useMemo, useState } from 'react';
import * as d3 from 'd3';
import { useStore } from '@/lib/store';
import { THREAD_LOG_FILL } from './graph-utils';
import { getThreadLogAtScene } from '@/lib/scene-filter';
import type { ThreadLog, Scene } from '@/types/narrative';
import { THREAD_LOG_NODE_TYPES } from '@/types/narrative';

type TLNode = d3.SimulationNodeDatum & { id: string; content: string; type: string; degree: number };
type TLLink = d3.SimulationLinkDatum<TLNode> & { relation: string };

export default function ThreadLogGraphView({
  threadId,
  threadDescription,
  fullThreadLog,
  scenes,
  resolvedKeys,
  currentIndex,
}: {
  threadId: string;
  threadDescription: string;
  fullThreadLog: ThreadLog;
  scenes: Record<string, Scene>;
  resolvedKeys: string[];
  currentIndex: number;
}) {
  const { dispatch } = useStore();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simRef = useRef<d3.Simulation<TLNode, TLLink> | null>(null);
  const gRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const nodesRef = useRef<TLNode[]>([]);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [showRelations, setShowRelations] = useState(false);
  const [showTypes, setShowTypes] = useState(true);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; content: string; type: string; degree: number } | null>(null);

  const graphData = useMemo(
    () => getThreadLogAtScene(fullThreadLog, threadId, scenes, resolvedKeys, currentIndex),
    [fullThreadLog, threadId, scenes, resolvedKeys, currentIndex],
  );

  // Initial setup
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();
    const g = svg.append('g');
    gRef.current = g;

    // Glow filters per type
    const defs = svg.append('defs');
    for (const type of THREAD_LOG_NODE_TYPES) {
      const color = THREAD_LOG_FILL[type] ?? '#fff';
      const filter = defs.append('filter').attr('id', `tl-glow-${type}`).attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
      filter.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'blur');
      filter.append('feFlood').attr('flood-color', color).attr('flood-opacity', '0.5').attr('result', 'color');
      filter.append('feComposite').attr('in', 'color').attr('in2', 'blur').attr('operator', 'in').attr('result', 'glow');
      const merge = filter.append('feMerge');
      merge.append('feMergeNode').attr('in', 'glow');
      merge.append('feMergeNode').attr('in', 'SourceGraphic');
    }

    // Arrow marker for directed sequential edges
    defs.append('marker')
      .attr('id', 'tl-arrow')
      .attr('viewBox', '0 0 10 10')
      .attr('refX', 18)
      .attr('refY', 5)
      .attr('markerWidth', 4)
      .attr('markerHeight', 4)
      .attr('orient', 'auto-start-reverse')
      .append('path').attr('d', 'M 0 0 L 10 5 L 0 10 z').attr('fill', '#555');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 4])
      .on('zoom', (event) => g.attr('transform', event.transform));
    svg.call(zoom);
    zoomRef.current = zoom;
    const width = svgEl.clientWidth ?? 800;
    const height = svgEl.clientHeight ?? 600;
    svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(0.9));

    g.append('g').attr('class', 'tl-links');
    g.append('g').attr('class', 'tl-nodes');
    g.append('g').attr('class', 'tl-labels');
    g.append('g').attr('class', 'tl-relations');

    const sim = d3.forceSimulation<TLNode, TLLink>()
      .force('link', d3.forceLink<TLNode, TLLink>([]).id((d) => d.id).distance(140))
      .force('charge', d3.forceManyBody().strength(-500))
      .force('center', d3.forceCenter(0, 0))
      .force('x', d3.forceX(0).strength(0.05))
      .force('y', d3.forceY(0).strength(0.05))
      .force('collide', d3.forceCollide<TLNode>().radius(40));
    simRef.current = sim;

    return () => { sim.stop(); simRef.current = null; gRef.current = null; };
  }, []);

  // Data update
  useEffect(() => {
    const sim = simRef.current;
    const g = gRef.current;
    if (!sim || !g) return;

    const { nodes: rawNodes, edges } = graphData;
    const degreeMap = new Map<string, number>();
    for (const e of edges) {
      degreeMap.set(e.from, (degreeMap.get(e.from) ?? 0) + 1);
      degreeMap.set(e.to, (degreeMap.get(e.to) ?? 0) + 1);
    }
    const maxDegree = Math.max(...rawNodes.map((n) => degreeMap.get(n.id) ?? 0), 1);
    const nodeRadius = (d: TLNode) => 10 + (d.degree / maxDegree) * 28;

    const prevPos = new Map(nodesRef.current.map((n) => [n.id, { x: n.x, y: n.y }]));
    const simNodes: TLNode[] = rawNodes.map((n) => {
      const prev = prevPos.get(n.id);
      return { id: n.id, content: n.content, type: n.type, degree: degreeMap.get(n.id) ?? 0, ...(prev ?? {}) };
    });
    nodesRef.current = simNodes;
    const nodeMap = new Map(simNodes.map((n) => [n.id, n]));
    const simLinks: TLLink[] = edges
      .filter((e) => nodeMap.has(e.from) && nodeMap.has(e.to))
      .map((e) => ({ source: nodeMap.get(e.from)!, target: nodeMap.get(e.to)!, relation: e.relation }));

    // Links
    const linkSel = g.select<SVGGElement>('g.tl-links')
      .selectAll<SVGLineElement, TLLink>('line')
      .data(simLinks, (d) => `${(d.source as TLNode).id}-${(d.target as TLNode).id}`);
    linkSel.exit().remove();
    const linkAll = linkSel.enter().append('line').merge(linkSel);
    linkAll
      .attr('stroke', '#ffffff25')
      .attr('stroke-width', 1)
      .attr('marker-end', 'url(#tl-arrow)');

    // Nodes
    const nodeSel = g.select<SVGGElement>('g.tl-nodes')
      .selectAll<SVGCircleElement, TLNode>('circle')
      .data(simNodes, (d) => d.id);
    nodeSel.exit().remove();
    const nodeAll = nodeSel.enter().append('circle').style('cursor', 'pointer').merge(nodeSel);
    nodeAll
      .attr('r', nodeRadius)
      .attr('fill', (d) => showTypes ? (THREAD_LOG_FILL[d.type] ?? '#888') : '#888')
      .attr('filter', (d) => showTypes ? `url(#tl-glow-${d.type})` : 'none')
      .attr('opacity', 0.9);

    // Drag
    const drag = d3.drag<SVGCircleElement, TLNode>()
      .on('start', (event, d) => { if (!event.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; setTooltip(null); })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on('end', (event, d) => { if (!event.active) sim.alphaTarget(0); d.fx = null; d.fy = null; });
    nodeAll.call(drag);

    nodeAll
      .on('mouseenter', (event, d) => {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        setTooltip({ x: event.clientX - rect.left, y: event.clientY - rect.top - 10, content: d.content, type: d.type, degree: d.degree });
      })
      .on('mouseleave', () => setTooltip(null))
      .on('click', (_event, d) => {
        _event.stopPropagation();
        dispatch({ type: 'SET_INSPECTOR', context: { type: 'threadLog', threadId, nodeId: d.id } });
      });

    // Labels
    const labelSel = g.select<SVGGElement>('g.tl-labels')
      .selectAll<SVGTextElement, TLNode>('text')
      .data(simNodes, (d) => d.id);
    labelSel.exit().remove();
    const labelAll = labelSel.enter().append('text').attr('text-anchor', 'middle').merge(labelSel);
    labelAll
      .attr('fill', (d) => showTypes ? (THREAD_LOG_FILL[d.type] ?? '#ccc') : '#ccc')
      .attr('font-size', (d) => `${Math.max(9, 9 + (d.degree / maxDegree) * 4)}px`)
      .attr('font-weight', (d) => d.degree >= maxDegree * 0.5 ? '600' : '400')
      .attr('display', showLabels ? 'block' : 'none')
      .attr('opacity', (d) => d.degree >= 2 ? 0.85 : 0.5)
      .text((d) => {
        const text = d.content ?? '';
        const colon = text.indexOf(':');
        const head = colon > 0 ? text.slice(0, colon) : text;
        return head.length > 40 ? head.slice(0, 40) + '…' : head;
      });

    // Relation labels
    const relSel = g.select<SVGGElement>('g.tl-relations')
      .selectAll<SVGTextElement, TLLink>('text')
      .data(simLinks, (d) => `${(d.source as TLNode).id}-${(d.target as TLNode).id}-rel`);
    relSel.exit().remove();
    const relAll = relSel.enter().append('text').attr('text-anchor', 'middle').attr('font-size', '7px').merge(relSel);
    relAll
      .attr('fill', '#ffffff30')
      .attr('display', showRelations ? 'block' : 'none')
      .text((d) => d.relation);

    // Simulation
    sim.nodes(simNodes);
    (sim.force('link') as d3.ForceLink<TLNode, TLLink>).links(simLinks);
    (sim.force('collide') as d3.ForceCollide<TLNode>).radius((d) => nodeRadius(d) + 30);
    sim.on('tick', () => {
      linkAll
        .attr('x1', (d) => (d.source as TLNode).x ?? 0).attr('y1', (d) => (d.source as TLNode).y ?? 0)
        .attr('x2', (d) => (d.target as TLNode).x ?? 0).attr('y2', (d) => (d.target as TLNode).y ?? 0);
      nodeAll.attr('cx', (d) => d.x ?? 0).attr('cy', (d) => d.y ?? 0);
      labelAll.attr('x', (d) => d.x ?? 0).attr('y', (d) => d.y ?? 0).attr('dy', (d) => -(nodeRadius(d) + 5));
      relAll
        .attr('x', (d) => ((d.source as TLNode).x! + (d.target as TLNode).x!) / 2)
        .attr('y', (d) => ((d.source as TLNode).y! + (d.target as TLNode).y!) / 2);
    });
    sim.alpha(0.5).restart();
  }, [graphData, showLabels, showRelations, showTypes, threadId, dispatch]);

  const legendItems = [
    { key: 'labels', label: 'Labels', checked: showLabels, toggle: () => setShowLabels((v) => !v) },
    { key: 'relations', label: 'Relations', checked: showRelations, toggle: () => setShowRelations((v) => !v) },
    { key: 'types', label: 'Types', checked: showTypes, toggle: () => setShowTypes((v) => !v) },
  ];

  const label = threadDescription.length > 40 ? threadDescription.slice(0, 38) + '…' : threadDescription;

  return (
    <div className="absolute inset-0 z-20 flex flex-col">
      {/* Legend strip */}
      <div className="shrink-0 flex items-center gap-0 px-2 h-7 border-b border-border bg-bg-base/60 z-30">
        <button
          onClick={() => dispatch({ type: 'SELECT_THREAD_LOG', threadId: null })}
          className="text-[10px] text-text-dim hover:text-text-secondary transition-colors flex items-center gap-1 mr-2"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
          Threads
        </button>
        <span className="text-[10px] text-text-dim mr-1">/</span>
        <span className="text-[10px] text-text-secondary font-medium mr-3" title={threadDescription}>{label}</span>
        <div className="w-px h-3 bg-border mr-1" />
        {legendItems.map(({ key, label, checked, toggle }) => (
          <button key={key} onClick={toggle}
            className={`text-[9px] px-2 py-1 rounded transition-colors select-none ${checked ? 'text-text-secondary' : 'text-text-dim/40 hover:text-text-dim'}`}>
            {label}
          </button>
        ))}
        {showTypes && (
          <>
            <div className="w-px h-3 bg-border mx-1" />
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {THREAD_LOG_NODE_TYPES.map((t) => (
                <div key={t} className="flex items-center gap-1 shrink-0">
                  <div className="w-2 h-2 rounded-full" style={{ background: THREAD_LOG_FILL[t] }} />
                  <span className="text-[8px] text-text-dim/60 capitalize">{t}</span>
                </div>
              ))}
            </div>
          </>
        )}
        <span className="text-[9px] text-text-dim ml-auto shrink-0">
          {graphData.nodes.length} nodes · {graphData.edges.length} edges
        </span>
      </div>

      {/* Canvas */}
      <div className="relative flex-1">
        <svg ref={svgRef} className="w-full h-full" />
        {tooltip && (
          <div
            className="absolute z-40 pointer-events-none"
            style={{ left: tooltip.x, top: tooltip.y - 12, transform: 'translate(-50%, -100%)' }}
          >
            <div className="bg-bg-elevated border border-border rounded-lg px-3 py-2 shadow-xl w-72">
              <div className="flex items-start gap-2 mb-1">
                <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-0.5" style={{ background: THREAD_LOG_FILL[tooltip.type] ?? '#888', boxShadow: `0 0 6px ${THREAD_LOG_FILL[tooltip.type] ?? '#888'}80` }} />
                <div>
                  <span className="text-xs font-semibold text-text-primary">{tooltip.content.slice(0, 120)}{tooltip.content.length > 120 ? '...' : ''}</span>
                  <span className="text-[10px] text-text-dim capitalize ml-1">({tooltip.type})</span>
                </div>
              </div>
              <div className="text-[10px] text-text-secondary">{tooltip.degree} connection{tooltip.degree !== 1 ? 's' : ''}</div>
            </div>
            <div className="flex justify-center"><div className="w-2.5 h-2.5 bg-bg-elevated border-r border-b border-border rotate-45 -mt-1.5" /></div>
          </div>
        )}
      </div>
    </div>
  );
}
