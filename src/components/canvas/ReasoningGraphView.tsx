"use client";

import { useStore } from "@/lib/store";
import type {
  ReasoningGraphSnapshot,
  ReasoningNodeSnapshot,
  ReasoningEdgeSnapshot,
} from "@/types/narrative";
import * as d3 from "d3";
import dagre from "dagre";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";

// ── Styling Constants ────────────────────────────────────────────────────────

type ReasoningEdgeType = ReasoningEdgeSnapshot["type"];

const NODE_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  fate: { fill: "#991b1b", stroke: "#ef4444", text: "#fee2e2" },       // Red — Fate force
  character: { fill: "#166534", stroke: "#22c55e", text: "#dcfce7" },
  location: { fill: "#14532d", stroke: "#16a34a", text: "#bbf7d0" },
  artifact: { fill: "#15803d", stroke: "#4ade80", text: "#f0fdf4" },
  system: { fill: "#1e3a8a", stroke: "#3b82f6", text: "#dbeafe" },
  reasoning: { fill: "#374151", stroke: "#6b7280", text: "#f3f4f6" },
  pattern: { fill: "#115e59", stroke: "#14b8a6", text: "#ccfbf1" },
  warning: { fill: "#881337", stroke: "#f43f5e", text: "#ffe4e6" },    // Rose — adversarial agent
  chaos: { fill: "#581c87", stroke: "#a855f7", text: "#f3e8ff" },      // Purple — outside force, spawns new entities
  unknown: { fill: "#374151", stroke: "#6b7280", text: "#f3f4f6" },
};

const getNodeColor = (type: string) => NODE_COLORS[type] ?? NODE_COLORS.unknown;

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

const NODE_WIDTH = 200;
const NODE_HEIGHT = 56;
const ACTIVE_NODE_COLOR = "#fbbf24";

// ── Dagre Layout Types ───────────────────────────────────────────────────────

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  data: ReasoningNodeSnapshot;
}

interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  type: ReasoningEdgeType;
  label?: string;
  points: { x: number; y: number }[];
}

// ── Component ────────────────────────────────────────────────────────────────

type Props = {
  graph: ReasoningGraphSnapshot;
  /** Arc ID when viewing arc reasoning */
  arcId?: string;
  /** World build ID when viewing expansion reasoning */
  worldBuildId?: string;
};

export function ReasoningGraphView({ graph, arcId, worldBuildId }: Props) {
  const { state, dispatch } = useStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const initialTransformRef = useRef<d3.ZoomTransform | null>(null);
  const [layoutNodes, setLayoutNodes] = useState<LayoutNode[]>([]);
  const [layoutEdges, setLayoutEdges] = useState<LayoutEdge[]>([]);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Track selected node from inspector context
  const selectedNodeId = useMemo(() => {
    const ctx = state.viewState.inspectorContext;
    if (ctx?.type === "reasoning") {
      // Match either by arcId or worldBuildId
      if ((arcId && ctx.arcId === arcId) || (worldBuildId && ctx.worldBuildId === worldBuildId)) {
        return ctx.nodeId;
      }
    }
    return null;
  }, [state.viewState.inspectorContext, arcId, worldBuildId]);

  // Handle clicking a node to open inspector
  const handleNodeClick = useCallback((node: ReasoningNodeSnapshot) => {
    dispatch({
      type: "SET_INSPECTOR",
      context: { type: "reasoning", arcId, worldBuildId, nodeId: node.id },
    });
  }, [dispatch, arcId, worldBuildId]);

  // Watch for container size changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setContainerSize({ width, height });
        }
      }
    });

    observer.observe(container);

    // Initial size check
    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setContainerSize({ width: rect.width, height: rect.height });
    }

    return () => observer.disconnect();
  }, []);

  // Compute dagre layout
  useEffect(() => {
    if (graph.nodes.length === 0) return;

    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: "TB",
      nodesep: 50,
      ranksep: 70,
      marginx: 40,
      marginy: 40,
    });
    g.setDefaultEdgeLabel(() => ({}));

    for (const node of graph.nodes) {
      g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    }

    for (const edge of graph.edges) {
      if (graph.nodes.some((n) => n.id === edge.from) && graph.nodes.some((n) => n.id === edge.to)) {
        g.setEdge(edge.from, edge.to);
      }
    }

    dagre.layout(g);

    const nodes: LayoutNode[] = graph.nodes.map((node) => {
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

    const edges: LayoutEdge[] = graph.edges
      .filter((e) => graph.nodes.some((n) => n.id === e.from) && graph.nodes.some((n) => n.id === e.to))
      .map((edge) => {
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

  // D3 visualization with dagre layout - depends on container size
  useEffect(() => {
    if (!svgRef.current || layoutNodes.length === 0 || containerSize.width === 0 || containerSize.height === 0) return;

    const svg = d3.select(svgRef.current);
    const width = containerSize.width;
    const height = containerSize.height;

    svg.selectAll("*").remove();

    const defs = svg.append("defs");
    const gMain = svg.append("g").attr("class", "main-group");
    const gEdges = gMain.append("g").attr("class", "edges");
    const gNodes = gMain.append("g").attr("class", "nodes");

    // Arrow markers
    for (const [type, color] of Object.entries(EDGE_COLORS)) {
      defs
        .append("marker")
        .attr("id", `arrow-canvas-${type}`)
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

    const lineGenerator = d3
      .line<{ x: number; y: number }>()
      .x((d) => d.x)
      .y((d) => d.y)
      .curve(d3.curveBasis);

    // Render edges
    gEdges
      .selectAll<SVGPathElement, LayoutEdge>("path")
      .data(layoutEdges)
      .join("path")
      .attr("d", (d) => lineGenerator(d.points) ?? "")
      .attr("fill", "none")
      .attr("stroke", (d) => EDGE_COLORS[d.type])
      .attr("stroke-width", 2)
      .attr("marker-end", (d) => `url(#arrow-canvas-${d.type})`)
      .attr("opacity", 0.7);

    // Edge labels
    gEdges
      .selectAll<SVGTextElement, LayoutEdge>("text")
      .data(layoutEdges)
      .join("text")
      .attr("x", (d) => {
        const mid = Math.floor(d.points.length / 2);
        return d.points[mid]?.x ?? 0;
      })
      .attr("y", (d) => {
        const mid = Math.floor(d.points.length / 2);
        return (d.points[mid]?.y ?? 0) - 6;
      })
      .attr("text-anchor", "middle")
      .attr("font-size", "9px")
      .attr("fill", (d) => EDGE_COLORS[d.type])
      .attr("opacity", 0.9)
      .text((d) => d.type);

    // Render nodes
    const nodeGroups = gNodes
      .selectAll<SVGGElement, LayoutNode>("g")
      .data(layoutNodes)
      .join("g")
      .attr("transform", (d) => `translate(${d.x - d.width / 2},${d.y - d.height / 2})`)
      .attr("cursor", "pointer")
      .on("click", (_, d) => {
        handleNodeClick(d.data);
      });

    // Node rectangles
    nodeGroups
      .append("rect")
      .attr("class", "node-rect")
      .attr("width", (d) => d.width)
      .attr("height", (d) => d.height)
      .attr("rx", 8)
      .attr("ry", 8)
      .attr("fill", (d) => getNodeColor(d.data.type).fill)
      .attr("stroke", (d) => getNodeColor(d.data.type).stroke)
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
      .text((d) => d.data.index);

    // Type badge (top-right)
    nodeGroups
      .append("rect")
      .attr("x", (d) => d.width - 60)
      .attr("y", 6)
      .attr("width", 54)
      .attr("height", 16)
      .attr("rx", 4)
      .attr("fill", "rgba(0,0,0,0.3)");

    nodeGroups
      .append("text")
      .attr("x", (d) => d.width - 33)
      .attr("y", 14)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("font-size", "9px")
      .attr("font-weight", "500")
      .attr("fill", (d) => getNodeColor(d.data.type).text)
      .attr("text-transform", "uppercase")
      .attr("letter-spacing", "0.5px")
      .text((d) => d.data.type.slice(0, 9));

    // Node label (main text)
    nodeGroups
      .append("text")
      .attr("x", (d) => d.width / 2)
      .attr("y", (d) => d.height / 2 + 6)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("font-size", "11px")
      .attr("font-weight", "500")
      .attr("fill", (d) => getNodeColor(d.data.type).text)
      .attr("pointer-events", "none")
      .text((d) => {
        const label = d.data.label;
        return label.length > 28 ? label.slice(0, 26) + "..." : label;
      });

    // Calculate bounds and center
    const bounds = {
      minX: Math.min(...layoutNodes.map((n) => n.x - n.width / 2)),
      maxX: Math.max(...layoutNodes.map((n) => n.x + n.width / 2)),
      minY: Math.min(...layoutNodes.map((n) => n.y - n.height / 2)),
      maxY: Math.max(...layoutNodes.map((n) => n.y + n.height / 2)),
    };
    const graphWidth = bounds.maxX - bounds.minX + 80;
    const graphHeight = bounds.maxY - bounds.minY + 80;
    const scale = Math.min(width / graphWidth, height / graphHeight, 1);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    const initialTransform = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(scale)
      .translate(-centerX, -centerY);

    initialTransformRef.current = initialTransform;

    // Setup zoom behavior
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 3])
      .on("zoom", (event) => {
        gMain.attr("transform", event.transform.toString());
      });

    zoomRef.current = zoom;

    // Apply zoom behavior to SVG
    svg.call(zoom);

    // Apply initial transform to center and scale the graph
    svg.call(zoom.transform, initialTransform);

  }, [layoutNodes, layoutEdges, containerSize, handleNodeClick]);

  // Highlight selected node
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);

    svg.selectAll<SVGGElement, LayoutNode>("g.nodes g").each(function (d) {
      const g = d3.select(this);
      const isSelected = d.id === selectedNodeId;

      g.select("rect.node-rect")
        .attr("stroke-width", isSelected ? 4 : 2)
        .attr("stroke", isSelected ? ACTIVE_NODE_COLOR : getNodeColor(d.data.type).stroke);
    });
  }, [selectedNodeId]);

  if (graph.nodes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-dim">
        No reasoning graph available
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 w-full h-full overflow-hidden">
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        className="cursor-grab active:cursor-grabbing"
        style={{ display: 'block' }}
      />
    </div>
  );
}
