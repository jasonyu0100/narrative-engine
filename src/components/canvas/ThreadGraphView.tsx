'use client';

import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import * as d3 from 'd3';
import type { NarrativeState, Scene } from '@/types/narrative';
import { THREAD_TERMINAL_STATUSES, resolveEntry } from '@/types/narrative';
import { computeThreadStatuses } from '@/lib/narrative-utils';
import { computeGroups } from './graph-utils';
import { IconChevronLeft, IconChevronRight, IconRefresh } from '@/components/icons';

// ── Status colors & glow ────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  dormant:    '#475569',
  active:     '#38BDF8',
  escalating: '#FBBF24',
  critical:   '#F87171',
  resolved:   '#34D399',
  subverted:  '#C084FC',
  abandoned:  '#64748B',
};

const TERMINAL = new Set<string>(THREAD_TERMINAL_STATUSES);

// ── Types ───────────────────────────────────────────────────────────────────

type TNode = d3.SimulationNodeDatum & {
  id: string;
  description: string;
  status: string;
  activity: number; // mutation count — drives size
  participantNames: string[];
  isMutatedAtScene: boolean; // whether this thread has a mutation at the current scene
};

type TLink = d3.SimulationLinkDatum<TNode> & {
  relation: 'dependent' | 'participant';
};

// ── Cluster detection (union-find by dependents + shared participants) ────

function buildLinks(narrative: NarrativeState, nodeIds: Set<string>): TLink[] {
  const links: TLink[] = [];
  const seen = new Set<string>();

  // Explicit dependents
  for (const t of Object.values(narrative.threads)) {
    if (!nodeIds.has(t.id)) continue;
    for (const depId of t.dependents) {
      if (!nodeIds.has(depId)) continue;
      const key = [t.id, depId].sort().join('|');
      if (!seen.has(key)) {
        seen.add(key);
        links.push({ source: t.id, target: depId, relation: 'dependent' });
      }
    }
  }

  // Shared participants
  const pMap = new Map<string, string[]>();
  for (const t of Object.values(narrative.threads)) {
    if (!nodeIds.has(t.id)) continue;
    for (const p of t.participants) {
      if (!pMap.has(p.id)) pMap.set(p.id, []);
      pMap.get(p.id)!.push(t.id);
    }
  }
  for (const [, ids] of pMap) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = [ids[i], ids[j]].sort().join('|');
        if (!seen.has(key)) {
          seen.add(key);
          links.push({ source: ids[i], target: ids[j], relation: 'participant' });
        }
      }
    }
  }

  return links;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function ThreadGraphView({
  narrative,
  resolvedKeys,
  currentIndex,
  mode,
  onSelectThread,
}: {
  narrative: NarrativeState;
  resolvedKeys: string[];
  currentIndex: number;
  mode: 'pulse' | 'threads';
  onSelectThread: (threadId: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simRef = useRef<d3.Simulation<TNode, TLink> | null>(null);
  const gRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const nodesRef = useRef<TNode[]>([]);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  const [showLabels, setShowLabels] = useState(true);
  const [showRelations, setShowRelations] = useState(false);
  const [showTypes, setShowTypes] = useState(true);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; description: string; status: string; participants: string[]; activity: number } | null>(null);
  const [groups, setGroups] = useState<TNode[][]>([]);
  const [focusedGroup, setFocusedGroup] = useState<number | null>(null);

  // ── Compute thread statuses at current scene ──
  const statuses = useMemo(
    () => computeThreadStatuses(narrative, currentIndex, resolvedKeys),
    [narrative, currentIndex, resolvedKeys],
  );

  // ── Compute mutation counts per thread and scene-specific mutations ──
  const { mutationCounts, sceneMutatedThreads } = useMemo(() => {
    const counts = new Map<string, number>();
    const sceneMuts = new Set<string>();

    for (let i = 0; i <= currentIndex && i < resolvedKeys.length; i++) {
      const key = resolvedKeys[i];
      const entry = resolveEntry(narrative, key);
      if (!entry) continue;
      if (entry.kind === 'scene') {
        for (const tm of entry.threadMutations) {
          counts.set(tm.threadId, (counts.get(tm.threadId) ?? 0) + 1);
          if (i === currentIndex) sceneMuts.add(tm.threadId);
        }
      } else if (entry.kind === 'world_build') {
        for (const t of entry.expansionManifest.threads) {
          counts.set(t.id, (counts.get(t.id) ?? 0) + 1);
          if (i === currentIndex) sceneMuts.add(t.id);
        }
      }
    }
    return { mutationCounts: counts, sceneMutatedThreads: sceneMuts };
  }, [narrative, resolvedKeys, currentIndex]);

  // ── Build graph data ──
  const graphData = useMemo(() => {
    const allThreads = Object.values(narrative.threads);
    const ACTIVE_STATUSES = new Set(['active', 'escalating', 'critical']);

    const visibleThreads = mode === 'pulse'
      ? allThreads.filter(t => sceneMutatedThreads.has(t.id))
      : allThreads;

    const nodeIds = new Set(visibleThreads.map(t => t.id));

    const nodes: TNode[] = visibleThreads.map(t => {
      const status = statuses[t.id] ?? t.status;
      const participantNames = t.participants.map(p =>
        narrative.characters[p.id]?.name ?? narrative.locations[p.id]?.name ?? p.id
      );
      return {
        id: t.id,
        description: t.description,
        status,
        activity: mutationCounts.get(t.id) ?? 0,
        participantNames,
        isMutatedAtScene: sceneMutatedThreads.has(t.id),
      };
    });

    const links = buildLinks(narrative, nodeIds);

    return { nodes, links };
  }, [narrative, mode, statuses, mutationCounts, sceneMutatedThreads]);

  // ── Initial SVG setup (once) ──
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const g = svg.append('g');
    gRef.current = g;

    // Glow filters for each status
    const defs = svg.append('defs');
    for (const [status, color] of Object.entries(STATUS_COLORS)) {
      const filter = defs.append('filter').attr('id', `tglow-${status}`).attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
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

    // Layer groups
    g.append('g').attr('class', 't-links');
    g.append('g').attr('class', 't-nodes');
    g.append('g').attr('class', 't-labels');
    g.append('g').attr('class', 't-relations');

    // Simulation
    const sim = d3.forceSimulation<TNode, TLink>()
      .force('link', d3.forceLink<TNode, TLink>([]).id((d) => d.id).distance(160))
      .force('charge', d3.forceManyBody().strength(-400))
      .force('center', d3.forceCenter(0, 0))
      .force('collide', d3.forceCollide<TNode>().radius(50));
    simRef.current = sim;

    return () => { sim.stop(); simRef.current = null; gRef.current = null; };
  }, []);

  // ── Data update ──
  useEffect(() => {
    const sim = simRef.current;
    const g = gRef.current;
    if (!sim || !g) return;

    const maxActivity = Math.max(...graphData.nodes.map(n => n.activity), 1);
    const nodeRadius = (d: TNode) => 8 + (d.activity / maxActivity) * 18;

    // Preserve positions
    const prevPos = new Map(nodesRef.current.map(n => [n.id, { x: n.x, y: n.y }]));
    const simNodes: TNode[] = graphData.nodes.map(n => {
      const prev = prevPos.get(n.id);
      return { ...n, ...(prev ?? {}) };
    });
    nodesRef.current = simNodes;
    const nodeMap = new Map(simNodes.map(n => [n.id, n]));

    const simLinks: TLink[] = graphData.links
      .filter(l => {
        const sId = typeof l.source === 'string' ? l.source : (l.source as TNode).id;
        const tId = typeof l.target === 'string' ? l.target : (l.target as TNode).id;
        return nodeMap.has(sId) && nodeMap.has(tId);
      })
      .map(l => ({
        source: typeof l.source === 'string' ? l.source : (l.source as TNode).id,
        target: typeof l.target === 'string' ? l.target : (l.target as TNode).id,
        relation: l.relation,
      }));

    // Links
    const linkSel = g.select<SVGGElement>('g.t-links')
      .selectAll<SVGLineElement, TLink>('line')
      .data(simLinks, d => `${(d.source as TNode).id ?? d.source}-${(d.target as TNode).id ?? d.target}`);
    linkSel.exit().remove();
    const linkEnter = linkSel.enter().append('line');
    const linkAll = linkEnter.merge(linkSel);
    linkAll
      .attr('stroke', d => d.relation === 'dependent' ? '#ffffff25' : '#ffffff10')
      .attr('stroke-width', d => d.relation === 'dependent' ? 1.5 : 0.8)
      .attr('stroke-dasharray', d => d.relation === 'participant' ? '3,3' : 'none');

    // Nodes
    const nodeSel = g.select<SVGGElement>('g.t-nodes')
      .selectAll<SVGCircleElement, TNode>('circle')
      .data(simNodes, d => d.id);
    nodeSel.exit().remove();
    const nodeEnter = nodeSel.enter().append('circle').style('cursor', 'pointer');
    const nodeAll = nodeEnter.merge(nodeSel);
    nodeAll
      .attr('r', nodeRadius)
      .attr('fill', d => showTypes ? (STATUS_COLORS[d.status] ?? '#475569') : '#888')
      .attr('filter', d => showTypes ? `url(#tglow-${d.status})` : 'none')
      .attr('opacity', d => {
        if (mode === 'pulse') return 0.9;
        // threads mode: highlight scene-mutated, dim terminal
        if (d.isMutatedAtScene) return 1;
        if (TERMINAL.has(d.status)) return 0.2;
        return 0.5;
      })
      .attr('stroke', d => {
        if (mode === 'threads' && d.isMutatedAtScene) return '#fff';
        return 'transparent';
      })
      .attr('stroke-width', 2);

    // Drag
    const drag = d3.drag<SVGCircleElement, TNode>()
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
        setTooltip({ x: event.clientX - rect.left, y: event.clientY - rect.top - 10, description: d.description, status: d.status, participants: d.participantNames, activity: d.activity });
      })
      .on('mouseleave', () => setTooltip(null))
      .on('click', (_event, d) => {
        _event.stopPropagation();
        onSelectThread(d.id);
      });

    // Labels
    const labelSel = g.select<SVGGElement>('g.t-labels')
      .selectAll<SVGTextElement, TNode>('text')
      .data(simNodes, d => d.id);
    labelSel.exit().remove();
    const labelEnter = labelSel.enter().append('text').attr('text-anchor', 'middle');
    const labelAll = labelEnter.merge(labelSel);
    labelAll
      .attr('fill', d => showTypes ? (STATUS_COLORS[d.status] ?? '#ccc') : '#ccc')
      .attr('font-size', d => `${Math.max(9, 9 + (d.activity / maxActivity) * 3)}px`)
      .attr('font-weight', d => d.activity >= maxActivity * 0.5 ? '600' : '400')
      .attr('display', showLabels ? 'block' : 'none')
      .attr('opacity', d => {
        if (mode === 'pulse') return 0.95;
        if (d.isMutatedAtScene) return 1;
        if (TERMINAL.has(d.status)) return 0.2;
        return 0.5;
      })
      .text(d => {
        const desc = d.description;
        return desc.length > 35 ? desc.slice(0, 33) + '…' : desc;
      });

    // Relation labels
    const relSel = g.select<SVGGElement>('g.t-relations')
      .selectAll<SVGTextElement, TLink>('text')
      .data(simLinks, d => `${(d.source as TNode).id ?? d.source}-${(d.target as TNode).id ?? d.target}-rel`);
    relSel.exit().remove();
    const relEnter = relSel.enter().append('text').attr('text-anchor', 'middle').attr('font-size', '8px');
    const relAll = relEnter.merge(relSel);
    relAll
      .attr('fill', '#ffffff25')
      .attr('display', showRelations ? 'block' : 'none')
      .text(d => d.relation === 'dependent' ? 'depends' : 'shared');

    // Update simulation
    sim.nodes(simNodes);
    (sim.force('link') as d3.ForceLink<TNode, TLink>).links(simLinks);
    (sim.force('collide') as d3.ForceCollide<TNode>).radius(d => nodeRadius(d) + 30);
    sim.on('tick', () => {
      linkAll
        .attr('x1', d => (d.source as TNode).x ?? 0)
        .attr('y1', d => (d.source as TNode).y ?? 0)
        .attr('x2', d => (d.target as TNode).x ?? 0)
        .attr('y2', d => (d.target as TNode).y ?? 0);
      nodeAll
        .attr('cx', d => d.x ?? 0)
        .attr('cy', d => d.y ?? 0);
      labelAll
        .attr('x', d => d.x ?? 0)
        .attr('y', d => d.y ?? 0)
        .attr('dy', d => -(nodeRadius(d) + 5));
      relAll
        .attr('x', d => ((d.source as TNode).x! + (d.target as TNode).x!) / 2)
        .attr('y', d => ((d.source as TNode).y! + (d.target as TNode).y!) / 2);
    });
    sim.alpha(0.5).restart();

    setGroups(computeGroups(simNodes, simLinks));
    setFocusedGroup(null);
  }, [graphData, mode, showLabels, showRelations, showTypes, onSelectThread]);

  // ── Zoom to focused group ──
  useEffect(() => {
    const svgEl = svgRef.current;
    const zoom = zoomRef.current;
    if (!svgEl || !zoom || focusedGroup === null || !groups[focusedGroup]) return;

    const group = groups[focusedGroup];
    const width = svgEl.clientWidth || 800;
    const height = svgEl.clientHeight || 600;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of group) {
      const x = n.x ?? 0, y = n.y ?? 0;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    const padding = 80;
    const bw = maxX - minX + padding * 2;
    const bh = maxY - minY + padding * 2;
    const scale = Math.min(width / bw, height / bh, 2);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;

    d3.select(svgEl)
      .transition()
      .duration(500)
      .call(
        zoom.transform as unknown as (t: d3.Transition<SVGSVGElement, unknown, null, undefined>) => void,
        d3.zoomIdentity.translate(width / 2, height / 2).scale(scale).translate(-cx, -cy),
      );
  }, [focusedGroup, groups]);

  const navigateGroup = useCallback(
    (direction: 'next' | 'prev' | 'reset') => {
      if (groups.length === 0) return;
      if (direction === 'reset') {
        setFocusedGroup(null);
        const svgEl = svgRef.current;
        const zoom = zoomRef.current;
        if (svgEl && zoom) {
          const w = svgEl.clientWidth ?? 800, h = svgEl.clientHeight ?? 600;
          d3.select(svgEl).transition().duration(500).call(
            zoom.transform as unknown as (t: d3.Transition<SVGSVGElement, unknown, null, undefined>) => void,
            d3.zoomIdentity.translate(w / 2, h / 2).scale(0.9),
          );
        }
        return;
      }
      setFocusedGroup(prev => {
        if (prev === null) return 0;
        if (direction === 'next') return (prev + 1) % groups.length;
        return (prev - 1 + groups.length) % groups.length;
      });
    },
    [groups],
  );

  return (
    <div className="absolute inset-0 z-20">
      <svg ref={svgRef} className="h-full w-full" style={{ background: 'transparent' }} />

      {/* Controls (top-left) */}
      <div className="absolute top-2 left-2 z-30 flex items-center gap-0">
        <label className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-bg-surface text-[11px] leading-none text-text-dim hover:text-text-default cursor-pointer select-none">
          <input type="checkbox" checked={showLabels} onChange={() => setShowLabels(v => !v)} className="accent-accent-cta w-3 h-3" />
          Labels
        </label>
        <label className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-bg-surface text-[11px] leading-none text-text-dim hover:text-text-default cursor-pointer select-none">
          <input type="checkbox" checked={showRelations} onChange={() => setShowRelations(v => !v)} className="accent-accent-cta w-3 h-3" />
          Relations
        </label>
        <label className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-bg-surface text-[11px] leading-none text-text-dim hover:text-text-default cursor-pointer select-none">
          <input type="checkbox" checked={showTypes} onChange={() => setShowTypes(v => !v)} className="accent-accent-cta w-3 h-3" />
          Types
        </label>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute z-40 pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y - 12, transform: 'translate(-50%, -100%)' }}
        >
          <div className="bg-bg-elevated border border-border rounded-lg px-3 py-2 shadow-xl w-72">
            <div className="flex items-start gap-2 mb-1">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0 mt-0.5"
                style={{ background: STATUS_COLORS[tooltip.status] ?? '#888', boxShadow: `0 0 6px ${STATUS_COLORS[tooltip.status] ?? '#888'}80` }}
              />
              <div>
                <span className="text-xs font-semibold text-text-primary">{tooltip.description}</span>
                <span className="text-[10px] text-text-dim capitalize ml-1">({tooltip.status})</span>
              </div>
            </div>
            {tooltip.participants.length > 0 && (
              <div className="text-[10px] text-text-secondary mb-0.5">{tooltip.participants.join(', ')}</div>
            )}
            <div className="text-[10px] text-text-dim">{tooltip.activity} mutation{tooltip.activity !== 1 ? 's' : ''}</div>
          </div>
          <div className="flex justify-center"><div className="w-2.5 h-2.5 bg-bg-elevated border-r border-b border-border rotate-45 -mt-1.5" /></div>
        </div>
      )}

      {/* Legend + Group navigation (bottom-left) */}
      <div className="absolute bottom-4 left-2 z-30 flex flex-col gap-1 items-start">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-bg-surface text-[10px] leading-none text-text-dim">
          {Object.entries(STATUS_COLORS).map(([status, color]) => (
            <span key={status} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
              <span className="capitalize">{status}</span>
            </span>
          ))}
        </div>
        {groups.length > 1 && (
        <div className="flex items-center gap-1 rounded bg-bg-surface text-[11px] leading-none">
          <button
            className="px-1.5 py-1.5 text-text-dim hover:text-text-default transition-colors"
            onClick={() => navigateGroup('prev')}
            title="Previous group"
          >
            <IconChevronLeft size={12} />
          </button>
          <span className="text-text-dim px-0.5 tabular-nums">
            {focusedGroup !== null
              ? `${focusedGroup + 1}/${groups.length} (${groups[focusedGroup].length})`
              : `${groups.length} groups`}
          </span>
          <button
            className="px-1.5 py-1.5 text-text-dim hover:text-text-default transition-colors"
            onClick={() => navigateGroup('next')}
            title="Next group"
          >
            <IconChevronRight size={12} />
          </button>
          {focusedGroup !== null && (
            <>
              <div className="w-px h-3.5 bg-border" />
              <button
                className="px-1.5 py-1.5 text-text-dim hover:text-text-default transition-colors"
                onClick={() => navigateGroup('reset')}
                title="Reset view"
              >
                <IconRefresh size={12} />
              </button>
            </>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
