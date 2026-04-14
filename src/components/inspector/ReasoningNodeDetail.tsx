"use client";

import { useStore } from "@/lib/store";
import type { ReasoningNodeSnapshot, ReasoningEdgeSnapshot } from "@/types/narrative";
import { useMemo } from "react";

type ReasoningNodeType = ReasoningNodeSnapshot["type"];
type ReasoningEdgeType = ReasoningEdgeSnapshot["type"];

const NODE_COLORS: Record<ReasoningNodeType, { fill: string; stroke: string; text: string }> = {
  fate: { fill: "#991b1b", stroke: "#ef4444", text: "#fee2e2" },       // Red — Fate force
  character: { fill: "#166534", stroke: "#22c55e", text: "#dcfce7" },
  location: { fill: "#14532d", stroke: "#16a34a", text: "#bbf7d0" },
  artifact: { fill: "#15803d", stroke: "#4ade80", text: "#f0fdf4" },
  system: { fill: "#1e3a8a", stroke: "#3b82f6", text: "#dbeafe" },
  reasoning: { fill: "#374151", stroke: "#6b7280", text: "#f3f4f6" },
  pattern: { fill: "#115e59", stroke: "#14b8a6", text: "#ccfbf1" },
  warning: { fill: "#881337", stroke: "#f43f5e", text: "#ffe4e6" },    // Rose — adversarial agent
  chaos: { fill: "#581c87", stroke: "#a855f7", text: "#f3e8ff" },      // Purple — outside force, spawns new entities
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

const TYPE_DESCRIPTIONS: Record<ReasoningNodeType, string> = {
  fate: "Thread's gravitational pull — influences events toward resolution or unexpected turns",
  character: "An active agent in the reasoning chain",
  location: "A setting that constrains or enables action",
  artifact: "An object with narrative significance",
  system: "A world rule, principle, or constraint",
  reasoning: "A logical step in the causal chain",
  pattern: "Positive reinforcement — encouraging variety and fresh approaches",
  warning: "Negative reinforcement — preventing stagnation and repetition",
  chaos: "Outside force — spawns a new character, location, artifact, or thread into the arc",
};

type Props = {
  arcId?: string;
  worldBuildId?: string;
  nodeId: string;
};

export default function ReasoningNodeDetail({ arcId, worldBuildId, nodeId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;

  const { node, sourceName, graph, connectedEdges } = useMemo(() => {
    if (!narrative) return { node: null, sourceName: null, graph: null, connectedEdges: [] };

    // Try arc first, then world build
    let graph = null;
    let sourceName: string | null = null;

    if (arcId) {
      const arc = narrative.arcs[arcId];
      if (arc?.reasoningGraph) {
        graph = arc.reasoningGraph;
        sourceName = arc.name;
      }
    }

    if (!graph && worldBuildId) {
      const worldBuild = narrative.worldBuilds[worldBuildId];
      if (worldBuild?.reasoningGraph) {
        graph = worldBuild.reasoningGraph;
        sourceName = worldBuild.summary.slice(0, 50);
      }
    }

    if (!graph) return { node: null, sourceName: null, graph: null, connectedEdges: [] };

    const node = graph.nodes.find((n) => n.id === nodeId);
    const connectedEdges = graph.edges.filter((e) => e.from === nodeId || e.to === nodeId);
    return { node, sourceName, graph, connectedEdges };
  }, [narrative, arcId, worldBuildId, nodeId]);

  if (!node || !graph) {
    return (
      <div className="text-text-dim text-sm">
        Reasoning node not found
      </div>
    );
  }

  const navigateToNode = (id: string) => {
    dispatch({
      type: "SET_INSPECTOR",
      context: { type: "reasoning", arcId, worldBuildId, nodeId: id },
    });
  };

  const navigateToEntity = () => {
    if (!node.entityId || !narrative) return;

    // Check if it's a character, location, or artifact
    if (narrative.characters[node.entityId]) {
      dispatch({
        type: "SET_INSPECTOR",
        context: { type: "character", characterId: node.entityId },
      });
    } else if (narrative.locations[node.entityId]) {
      dispatch({
        type: "SET_INSPECTOR",
        context: { type: "location", locationId: node.entityId },
      });
    } else if (narrative.artifacts?.[node.entityId]) {
      dispatch({
        type: "SET_INSPECTOR",
        context: { type: "artifact", artifactId: node.entityId },
      });
    }
  };

  const navigateToThread = () => {
    if (!node.threadId) return;
    dispatch({
      type: "SET_INSPECTOR",
      context: { type: "thread", threadId: node.threadId },
    });
  };

  const colors = NODE_COLORS[node.type];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold shrink-0"
          style={{ backgroundColor: colors.fill, color: colors.text }}
        >
          {node.index}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="px-2 py-0.5 rounded text-[9px] font-medium uppercase tracking-wider"
              style={{ backgroundColor: colors.fill, color: colors.text }}
            >
              {node.type}
            </span>
            <span className="text-[10px] text-text-dim font-mono">#{node.id}</span>
          </div>
          <h2 className="text-sm font-semibold text-text-primary leading-snug">
            {node.label}
          </h2>
        </div>
      </div>

      {/* Type description */}
      <p className="text-[10px] text-text-dim italic">
        {TYPE_DESCRIPTIONS[node.type]}
      </p>

      {/* Detail */}
      {node.detail && (
        <div className="space-y-1">
          <h3 className="text-[10px] uppercase tracking-wider text-text-dim">Detail</h3>
          <p className="text-xs text-text-secondary leading-relaxed">
            {node.detail}
          </p>
        </div>
      )}

      {/* References */}
      {(node.entityId || node.threadId) && (
        <div className="space-y-2">
          <h3 className="text-[10px] uppercase tracking-wider text-text-dim">References</h3>
          <div className="space-y-1.5">
            {node.entityId && (
              <button
                onClick={navigateToEntity}
                className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded bg-white/3 hover:bg-white/6 transition group"
              >
                <span className="text-[10px] text-text-dim">Entity:</span>
                <span className="text-[11px] text-cyan-400 font-mono group-hover:text-cyan-300 transition">
                  {node.entityId}
                </span>
              </button>
            )}
            {node.threadId && (
              <button
                onClick={navigateToThread}
                className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded bg-white/3 hover:bg-white/6 transition group"
              >
                <span className="text-[10px] text-text-dim">Thread:</span>
                <span className="text-[11px] text-amber-400 font-mono group-hover:text-amber-300 transition">
                  {node.threadId}
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Connections */}
      {connectedEdges.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[10px] uppercase tracking-wider text-text-dim">
            Connections ({connectedEdges.length})
          </h3>
          <div className="space-y-1">
            {connectedEdges.map((edge) => {
              const isOutgoing = edge.from === nodeId;
              const otherId = isOutgoing ? edge.to : edge.from;
              const otherNode = graph.nodes.find((n) => n.id === otherId);

              return (
                <button
                  key={edge.id}
                  onClick={() => navigateToNode(otherId)}
                  className="w-full text-left px-2 py-1.5 rounded bg-white/3 hover:bg-white/6 transition group"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[10px] font-mono shrink-0"
                      style={{ color: EDGE_COLORS[edge.type] }}
                    >
                      {isOutgoing ? "->" : "<-"} {edge.type}
                    </span>
                    <span className="text-[11px] text-text-secondary group-hover:text-text-primary transition truncate flex-1">
                      {otherNode?.label ?? otherId}
                    </span>
                    {otherNode && (
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded shrink-0"
                        style={{
                          backgroundColor: NODE_COLORS[otherNode.type].fill,
                          color: NODE_COLORS[otherNode.type].text,
                        }}
                      >
                        {otherNode.type}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Source context */}
      <div className="pt-3 border-t border-border space-y-2">
        <h3 className="text-[10px] uppercase tracking-wider text-text-dim">
          {arcId ? "Arc" : "World Expansion"}
        </h3>
        <div className="text-xs text-text-secondary">
          <span className="font-medium text-text-primary">{sourceName}</span>
          <span className="text-text-dim"> &middot; {graph.nodes.length} nodes</span>
        </div>
        <p className="text-[10px] text-text-dim leading-relaxed">
          {graph.summary}
        </p>
      </div>

      {/* Legend */}
      <div className="pt-3 border-t border-border space-y-2">
        <h3 className="text-[10px] uppercase tracking-wider text-text-dim">Node Types</h3>
        <div className="grid grid-cols-2 gap-1">
          {(Object.keys(NODE_COLORS) as ReasoningNodeType[]).map((type) => (
            <div key={type} className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded"
                style={{ backgroundColor: NODE_COLORS[type].fill }}
              />
              <span className={`text-[9px] capitalize ${type === node.type ? "text-text-primary font-medium" : "text-text-dim"}`}>
                {type}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
