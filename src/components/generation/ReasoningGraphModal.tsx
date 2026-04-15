"use client";

import { IconRefresh } from "@/components/icons";
import type {
  ReasoningGraph,
  ReasoningNode,
  ReasoningNodeType,
  ReasoningEdgeType,
} from "@/lib/ai";
import { buildSequentialPath } from "@/lib/ai";
import * as d3 from "d3";
import dagre from "dagre";
import { useEffect, useMemo, useRef, useState } from "react";

// ── Styling Constants ────────────────────────────────────────────────────────

// Color language: Fate = red (threads/fate force), World entities = green, System = blue, Reasoning = grey
const NODE_COLORS: Record<ReasoningNodeType, { fill: string; stroke: string; text: string }> = {
  // Fate/Threads — red (Fate force) — can appear anywhere in reasoning chain
  fate: { fill: "#991b1b", stroke: "#ef4444", text: "#fee2e2" },       // Red
  // World entities — shades of green (World force)
  character: { fill: "#166534", stroke: "#22c55e", text: "#dcfce7" },  // Dark green
  location: { fill: "#14532d", stroke: "#16a34a", text: "#bbf7d0" },   // Darker green
  artifact: { fill: "#15803d", stroke: "#4ade80", text: "#f0fdf4" },   // Medium green
  // System — blue (System force)
  system: { fill: "#1e3a8a", stroke: "#3b82f6", text: "#dbeafe" },     // Blue
  // Reasoning — grey (neutral)
  reasoning: { fill: "#374151", stroke: "#6b7280", text: "#f3f4f6" },  // Grey
  // Pattern — cyan/teal (positive reinforcement)
  pattern: { fill: "#115e59", stroke: "#14b8a6", text: "#ccfbf1" },    // Teal
  // Warning — rose (anti-pattern risk)
  warning: { fill: "#881337", stroke: "#f43f5e", text: "#ffe4e6" },    // Rose
  // Chaos — purple (outside force; spawns new entities into the arc)
  chaos: { fill: "#581c87", stroke: "#a855f7", text: "#f3e8ff" },      // Purple
};

const EDGE_COLORS: Record<ReasoningEdgeType, string> = {
  enables: "#22c55e",
  constrains: "#ef4444",
  risks: "#f59e0b",
  requires: "#3b82f6",
  causes: "#64748b",
  reveals: "#a855f7",
  develops: "#06b6d4",
  resolves: "#10b981",
};

// Node dimensions for dagre layout
const NODE_WIDTH = 200;
const NODE_HEIGHT = 56;

// ── Dagre Layout Types ───────────────────────────────────────────────────────

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  data: ReasoningNode;
}

interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  type: ReasoningEdgeType;
  label?: string;
  points: { x: number; y: number }[];
}

// Active node highlight color (yellow for demos)
const ACTIVE_NODE_COLOR = "#fbbf24"; // Amber/yellow

// ── Component ────────────────────────────────────────────────────────────────

type Props = {
  graph: ReasoningGraph;
  isLoading?: boolean;
  onRegenerate: (additionalPrompt?: string) => void;
  onConfirm: () => void;
  onClose: () => void;
  /** Custom label for the confirm button. Defaults to "Generate N Scene(s)" */
  confirmLabel?: string;
};

export function ReasoningGraphModal({
  graph,
  isLoading,
  onRegenerate,
  onConfirm,
  onClose,
  confirmLabel,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const initialTransformRef = useRef<d3.ZoomTransform | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [layoutNodes, setLayoutNodes] = useState<LayoutNode[]>([]);
  const [layoutEdges, setLayoutEdges] = useState<LayoutEdge[]>([]);
  const [showRegenerateInput, setShowRegenerateInput] = useState(false);
  const [regeneratePrompt, setRegeneratePrompt] = useState("");
  const [copied, setCopied] = useState(false);

  const sortedNodes = useMemo(
    () => [...graph.nodes].sort((a, b) => a.index - b.index),
    [graph.nodes]
  );
  const sortedNodesRef = useRef(sortedNodes);
  sortedNodesRef.current = sortedNodes;

  const focusedNode = sortedNodes[focusedIndex] ?? null;
  const maxIndex = sortedNodes.length - 1;

  // Store callbacks in refs to avoid useEffect dependency changes
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Compute dagre layout
  useEffect(() => {
    if (graph.nodes.length === 0) return;

    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: "TB", // Top to bottom
      nodesep: 50,
      ranksep: 70,
      marginx: 40,
      marginy: 40,
    });
    g.setDefaultEdgeLabel(() => ({}));

    // Add nodes
    for (const node of graph.nodes) {
      g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    }

    // Add edges
    for (const edge of graph.edges) {
      if (graph.nodes.some(n => n.id === edge.from) && graph.nodes.some(n => n.id === edge.to)) {
        g.setEdge(edge.from, edge.to);
      }
    }

    // Run layout
    dagre.layout(g);

    // Extract positioned nodes
    const nodes: LayoutNode[] = graph.nodes.map(node => {
      const layoutNode = g.node(node.id);
      return {
        id: node.id,
        x: layoutNode.x,
        y: layoutNode.y,
        width: layoutNode.width,
        height: layoutNode.height,
        data: node,
      };
    });

    // Extract edges with points
    const edges: LayoutEdge[] = graph.edges
      .filter(e => graph.nodes.some(n => n.id === e.from) && graph.nodes.some(n => n.id === e.to))
      .map(edge => {
        const layoutEdge = g.edge(edge.from, edge.to);
        return {
          id: edge.id,
          source: edge.from,
          target: edge.to,
          type: edge.type,
          label: edge.label,
          points: layoutEdge?.points ?? [],
        };
      });

    setLayoutNodes(nodes);
    setLayoutEdges(edges);
  }, [graph]);

  // Keyboard navigation (only arrows and escape - no Enter or R)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === "ArrowRight" || e.key === "j") {
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(prev + 1, maxIndex));
      } else if (e.key === "ArrowLeft" || e.key === "k") {
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Escape") {
        if (showRegenerateInput) {
          setShowRegenerateInput(false);
          setRegeneratePrompt("");
        } else {
          onCloseRef.current();
        }
      } else if (e.key === "Home") {
        e.preventDefault();
        setFocusedIndex(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setFocusedIndex(maxIndex);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [maxIndex, showRegenerateInput]);

  // D3 visualization with dagre layout
  useEffect(() => {
    if (!svgRef.current || !containerRef.current || layoutNodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    const rect = containerRef.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    // Clear previous
    svg.selectAll("*").remove();

    // Create layers
    const defs = svg.append("defs");
    const gMain = svg.append("g").attr("class", "main-group");
    const gEdges = gMain.append("g").attr("class", "edges");
    const gNodes = gMain.append("g").attr("class", "nodes");

    // Arrow markers
    for (const [type, color] of Object.entries(EDGE_COLORS)) {
      defs
        .append("marker")
        .attr("id", `arrow-${type}`)
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 8)
        .attr("refY", 0)
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-4L10,0L0,4")
        .attr("fill", color);
    }

    // Line generator for edges
    const lineGenerator = d3.line<{ x: number; y: number }>()
      .x(d => d.x)
      .y(d => d.y)
      .curve(d3.curveBasis);

    // Render edges
    gEdges
      .selectAll<SVGPathElement, LayoutEdge>("path")
      .data(layoutEdges)
      .join("path")
      .attr("d", d => lineGenerator(d.points) ?? "")
      .attr("fill", "none")
      .attr("stroke", d => EDGE_COLORS[d.type])
      .attr("stroke-width", 2)
      .attr("marker-end", d => `url(#arrow-${d.type})`)
      .attr("opacity", 0.7);

    // Edge labels
    gEdges
      .selectAll<SVGTextElement, LayoutEdge>("text")
      .data(layoutEdges)
      .join("text")
      .attr("x", d => {
        const mid = Math.floor(d.points.length / 2);
        return d.points[mid]?.x ?? 0;
      })
      .attr("y", d => {
        const mid = Math.floor(d.points.length / 2);
        return (d.points[mid]?.y ?? 0) - 6;
      })
      .attr("text-anchor", "middle")
      .attr("font-size", "9px")
      .attr("fill", d => EDGE_COLORS[d.type])
      .attr("opacity", 0.9)
      .text(d => d.type);

    // Render nodes
    const nodeGroups = gNodes
      .selectAll<SVGGElement, LayoutNode>("g")
      .data(layoutNodes)
      .join("g")
      .attr("transform", d => `translate(${d.x - d.width / 2},${d.y - d.height / 2})`)
      .attr("cursor", "pointer")
      .on("click", (_, d) => {
        const idx = sortedNodesRef.current.findIndex(n => n.id === d.id);
        if (idx >= 0) setFocusedIndex(idx);
      });

    // Node rectangles (rounded like mermaid)
    nodeGroups
      .append("rect")
      .attr("class", "node-rect")
      .attr("width", d => d.width)
      .attr("height", d => d.height)
      .attr("rx", 8)
      .attr("ry", 8)
      .attr("fill", d => NODE_COLORS[d.data.type].fill)
      .attr("stroke", d => NODE_COLORS[d.data.type].stroke)
      .attr("stroke-width", 2);

    // Index badge (top-left)
    nodeGroups
      .append("circle")
      .attr("cx", 0)
      .attr("cy", 0)
      .attr("r", 12)
      .attr("fill", "#0f172a")
      .attr("stroke", "#475569")
      .attr("stroke-width", 1);

    nodeGroups
      .append("text")
      .attr("x", 0)
      .attr("y", 0)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("font-size", "10px")
      .attr("font-weight", "bold")
      .attr("fill", "#e2e8f0")
      .attr("pointer-events", "none")
      .text(d => d.data.index);

    // Generation-order pill — only when it differs from the presentation
    // index (backward thinking modes). Presentation is primary; generation
    // shows as a small corner badge so the thinking signature is visible.
    const divergentNodes = nodeGroups.filter(
      d =>
        typeof d.data.generationOrder === "number" &&
        d.data.generationOrder !== d.data.index,
    );

    divergentNodes
      .append("rect")
      .attr("x", 8)
      .attr("y", 6)
      .attr("width", 16)
      .attr("height", 10)
      .attr("rx", 2)
      .attr("fill", "rgba(15,23,42,0.9)")
      .attr("stroke", "rgba(148,163,184,0.4)")
      .attr("stroke-width", 0.5);

    divergentNodes
      .append("text")
      .attr("x", 16)
      .attr("y", 11)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("font-size", "7px")
      .attr("font-weight", "500")
      .attr("fill", "#94a3b8")
      .attr("pointer-events", "none")
      .text(d => `g${d.data.generationOrder}`);

    divergentNodes
      .append("title")
      .text(d => `Presented at index ${d.data.index} · Generated ${(d.data.generationOrder ?? 0) + 1}`);

    // Type badge (top-right)
    nodeGroups
      .append("rect")
      .attr("x", d => d.width - 60)
      .attr("y", 6)
      .attr("width", 54)
      .attr("height", 16)
      .attr("rx", 4)
      .attr("fill", "rgba(0,0,0,0.3)");

    nodeGroups
      .append("text")
      .attr("x", d => d.width - 33)
      .attr("y", 14)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("font-size", "9px")
      .attr("font-weight", "500")
      .attr("fill", d => NODE_COLORS[d.data.type].text)
      .attr("text-transform", "uppercase")
      .attr("letter-spacing", "0.5px")
      .text(d => d.data.type.slice(0, 9));

    // Node label (main text)
    nodeGroups
      .append("text")
      .attr("x", d => d.width / 2)
      .attr("y", d => d.height / 2 + 6)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("font-size", "11px")
      .attr("font-weight", "500")
      .attr("fill", d => NODE_COLORS[d.data.type].text)
      .attr("pointer-events", "none")
      .text(d => {
        const label = d.data.label;
        return label.length > 28 ? label.slice(0, 26) + "…" : label;
      });

    // Calculate bounds and center
    const bounds = {
      minX: Math.min(...layoutNodes.map(n => n.x - n.width / 2)),
      maxX: Math.max(...layoutNodes.map(n => n.x + n.width / 2)),
      minY: Math.min(...layoutNodes.map(n => n.y - n.height / 2)),
      maxY: Math.max(...layoutNodes.map(n => n.y + n.height / 2)),
    };
    const graphWidth = bounds.maxX - bounds.minX + 80;
    const graphHeight = bounds.maxY - bounds.minY + 80;
    const scale = Math.min(width / graphWidth, height / graphHeight, 1);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    // Initial transform to center
    const initialTransform = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(scale)
      .translate(-centerX, -centerY);

    initialTransformRef.current = initialTransform;

    // Zoom behavior
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 2])
      .on("zoom", (event) => {
        gMain.attr("transform", event.transform.toString());
        setTransform({
          x: event.transform.x,
          y: event.transform.y,
          k: event.transform.k,
        });
      });

    zoomRef.current = zoom;
    svg.call(zoom);
    svg.call(zoom.transform, initialTransform);

  }, [layoutNodes, layoutEdges]);

  // Highlight focused node with yellow
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);

    svg.selectAll<SVGGElement, LayoutNode>("g.nodes g").each(function(d) {
      const g = d3.select(this);
      const isFocused = d.id === focusedNode?.id;

      g.select("rect.node-rect")
        .attr("stroke-width", isFocused ? 4 : 2)
        .attr("stroke", isFocused ? ACTIVE_NODE_COLOR : NODE_COLORS[d.data.type].stroke);
    });
  }, [focusedNode]);

  // Reset view to center
  const handleResetView = () => {
    if (svgRef.current && zoomRef.current && initialTransformRef.current) {
      const svg = d3.select(svgRef.current);
      svg.transition().duration(300).call(zoomRef.current.transform, initialTransformRef.current);
    }
  };

  // Get connected edges for focused node
  const connectedEdges = graph.edges.filter(
    (e) => e.from === focusedNode?.id || e.to === focusedNode?.id
  );

  // Progress calculation
  const progress = ((focusedIndex + 1) / sortedNodes.length) * 100;

  return (
    <div className="fixed inset-0 bg-black/95 z-60 flex flex-col">
      <div className="flex-1 min-h-0 flex flex-col p-6">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-text-dim hover:text-text-primary text-lg leading-none z-10"
        >
          &times;
        </button>

        {/* Header */}
        <h2 className="text-sm font-semibold text-text-primary mb-1">{graph.arcName}</h2>
        <p className="text-[10px] text-text-dim uppercase tracking-wider mb-3">
          Reasoning Graph · {graph.nodes.length} nodes · {graph.edges.length} connections
        </p>

        {/* Summary */}
        <p className="text-xs text-text-secondary mb-4 max-w-3xl">{graph.summary}</p>

        {/* Progress bar */}
        <div className="mb-4">
          <div className="h-2 bg-white/6 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-200 bg-amber-500/60"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-[10px] text-text-dim font-mono">
              Step {focusedIndex + 1} of {sortedNodes.length}
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={handleResetView}
                className="text-[10px] text-text-dim hover:text-text-primary transition"
              >
                Reset View
              </button>
              <span className="text-[10px] text-text-dim">
                {Math.round(transform.k * 100)}%
              </span>
            </div>
          </div>
        </div>

        {/* Two-column: Graph + Inspector */}
        <div className="flex-1 min-h-0 flex gap-4">
          {/* Graph visualization */}
          <div ref={containerRef} className="flex-1 min-w-0 overflow-hidden border border-border rounded-lg bg-bg-elevated/50 relative">
            {isLoading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-10 h-10 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                  <span className="text-sm text-text-dim">Generating reasoning graph...</span>
                </div>
              </div>
            ) : (
              <svg ref={svgRef} width="100%" height="100%" className="cursor-grab active:cursor-grabbing" />
            )}
          </div>

          {/* Inspector panel */}
          <div className="w-80 shrink-0 overflow-auto border border-border rounded-lg bg-bg-elevated/50 p-4 flex flex-col">
            {/* Current node detail */}
            {focusedNode && (
              <div className="flex-1 flex flex-col gap-4">
                {/* Type badge */}
                <div className="flex items-center gap-2">
                  <span
                    className="px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider"
                    style={{
                      backgroundColor: NODE_COLORS[focusedNode.type].fill,
                      color: NODE_COLORS[focusedNode.type].text,
                    }}
                  >
                    {focusedNode.type}
                  </span>
                  <span className="text-[10px] text-text-dim">#{focusedNode.id}</span>
                  <span className="text-[10px] text-text-dim ml-auto">
                    Index {focusedNode.index}
                    {typeof focusedNode.generationOrder === "number" && focusedNode.generationOrder !== focusedNode.index && (
                      <span className="ml-1.5 text-text-dim/60" title="Order the reasoner thought of this node">
                        · gen {focusedNode.generationOrder}
                      </span>
                    )}
                  </span>
                </div>

                {/* Label */}
                <h3 className="text-sm font-medium text-text-primary leading-snug">
                  {focusedNode.label}
                </h3>

                {/* Detail */}
                {focusedNode.detail && (
                  <p className="text-xs text-text-secondary leading-relaxed">
                    {focusedNode.detail}
                  </p>
                )}

                {/* References */}
                {(focusedNode.entityId || focusedNode.threadId) && (
                  <div className="space-y-1 pt-2 border-t border-border">
                    {focusedNode.entityId && (
                      <div className="text-xs text-text-dim">
                        Entity: <span className="text-cyan-400 font-mono">{focusedNode.entityId}</span>
                      </div>
                    )}
                    {focusedNode.threadId && (
                      <div className="text-xs text-text-dim">
                        Thread: <span className="text-amber-400 font-mono">{focusedNode.threadId}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Connections */}
                {connectedEdges.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-border">
                    <h4 className="text-[10px] uppercase tracking-wider text-text-dim">
                      Connections ({connectedEdges.length})
                    </h4>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {connectedEdges.map((edge) => {
                        const isOutgoing = edge.from === focusedNode.id;
                        const otherId = isOutgoing ? edge.to : edge.from;
                        const otherNode = graph.nodes.find((n) => n.id === otherId);

                        return (
                          <button
                            key={edge.id}
                            onClick={() => {
                              const idx = sortedNodes.findIndex((n) => n.id === otherId);
                              if (idx >= 0) setFocusedIndex(idx);
                            }}
                            className="w-full text-left px-2 py-1.5 rounded bg-white/3 hover:bg-white/6 transition group"
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className="text-[10px] font-mono shrink-0"
                                style={{ color: EDGE_COLORS[edge.type] }}
                              >
                                {isOutgoing ? "→" : "←"} {edge.type}
                              </span>
                              <span className="text-[11px] text-text-secondary group-hover:text-text-primary transition truncate">
                                {otherNode?.label ?? otherId}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Navigation buttons */}
                <div className="flex gap-2 pt-2 border-t border-border mt-auto">
                  <button
                    onClick={() => setFocusedIndex((p) => Math.max(0, p - 1))}
                    disabled={focusedIndex === 0}
                    className="flex-1 py-2 rounded bg-white/5 text-text-dim hover:bg-white/8 hover:text-text-primary disabled:opacity-30 transition text-xs"
                  >
                    ← Previous
                  </button>
                  <button
                    onClick={() => setFocusedIndex((p) => Math.min(maxIndex, p + 1))}
                    disabled={focusedIndex === maxIndex}
                    className="flex-1 py-2 rounded bg-white/5 text-text-dim hover:bg-white/8 hover:text-text-primary disabled:opacity-30 transition text-xs"
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}

            {/* Legend */}
            <div className="pt-4 border-t border-border mt-4">
              <h4 className="text-[10px] uppercase tracking-wider text-text-dim mb-2">
                Node Types
              </h4>
              <div className="grid grid-cols-2 gap-1">
                {(Object.keys(NODE_COLORS) as ReasoningNodeType[]).map((type) => (
                  <div key={type} className="flex items-center gap-1.5">
                    <span
                      className="w-3 h-3 rounded"
                      style={{ backgroundColor: NODE_COLORS[type].fill }}
                    />
                    <span className="text-[10px] text-text-dim capitalize">{type}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 mt-4 border-t border-border shrink-0">
          <div className="flex items-center gap-4 text-[10px] text-text-dim">
            <span><kbd className="px-1.5 py-0.5 rounded bg-white/10 font-mono">←</kbd> <kbd className="px-1.5 py-0.5 rounded bg-white/10 font-mono">→</kbd> Navigate</span>
            <span><kbd className="px-1.5 py-0.5 rounded bg-white/10 font-mono">Esc</kbd> Cancel</span>
            <span>Scroll to zoom · Drag to pan</span>
          </div>

          <div className="flex gap-2 items-center">
            <button
              onClick={() => {
                navigator.clipboard.writeText(buildSequentialPath(graph));
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="text-xs px-4 py-2 rounded-lg bg-white/4 text-text-secondary hover:bg-white/8 transition-colors"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
            {showRegenerateInput ? (
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={regeneratePrompt}
                  onChange={(e) => setRegeneratePrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      onRegenerate(regeneratePrompt || undefined);
                      setShowRegenerateInput(false);
                      setRegeneratePrompt("");
                    } else if (e.key === "Escape") {
                      setShowRegenerateInput(false);
                      setRegeneratePrompt("");
                    }
                  }}
                  placeholder="Additional guidance (optional)..."
                  className="text-xs px-3 py-2 rounded-lg bg-white/6 border border-border text-text-primary placeholder:text-text-dim w-64 focus:outline-none focus:border-white/20"
                  autoFocus
                />
                <button
                  onClick={() => {
                    onRegenerate(regeneratePrompt || undefined);
                    setShowRegenerateInput(false);
                    setRegeneratePrompt("");
                  }}
                  disabled={isLoading}
                  className="text-xs px-4 py-2 rounded-lg bg-white/8 text-text-primary hover:bg-white/12 transition-colors disabled:opacity-50"
                >
                  Go
                </button>
                <button
                  onClick={() => {
                    setShowRegenerateInput(false);
                    setRegeneratePrompt("");
                  }}
                  className="text-xs px-2 py-2 text-text-dim hover:text-text-primary transition-colors"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowRegenerateInput(true)}
                disabled={isLoading}
                className="text-xs px-4 py-2 rounded-lg bg-white/4 text-text-secondary hover:bg-white/8 transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <IconRefresh size={14} />
                Regenerate
              </button>
            )}
            <button
              onClick={onClose}
              className="text-xs px-4 py-2 rounded-lg bg-white/4 text-text-dim hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={isLoading}
              className="text-xs font-semibold px-5 py-2 rounded-lg bg-white/12 text-text-primary hover:bg-white/16 transition-colors disabled:opacity-50"
            >
              {confirmLabel ?? `Generate ${graph.sceneCount} Scene${graph.sceneCount !== 1 ? "s" : ""}`} →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
