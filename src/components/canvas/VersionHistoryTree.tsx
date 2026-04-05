"use client";

import { useState, useMemo } from "react";
import type { ProseVersion, PlanVersion } from "@/types/narrative";

type VersionTreeNode = {
  version: string;
  versionType: "generate" | "rewrite" | "edit";
  timestamp: number;
  children: VersionTreeNode[];
  data: ProseVersion | PlanVersion;
};

function buildVersionTree<T extends ProseVersion | PlanVersion>(
  versions: T[]
): VersionTreeNode[] {
  // Sort versions by timestamp
  const sorted = [...versions].sort((a, b) => a.timestamp - b.timestamp);

  // Group by major version
  const majorGroups = new Map<string, T[]>();
  for (const v of sorted) {
    const major = v.version.split(".")[0];
    const existing = majorGroups.get(major) ?? [];
    existing.push(v);
    majorGroups.set(major, existing);
  }

  // Build tree structure
  const tree: VersionTreeNode[] = [];

  for (const [major, versions] of majorGroups) {
    // Find the major version (no minor)
    const majorVersion = versions.find((v) => v.version === major);
    const minorVersions = versions.filter(
      (v) => v.version !== major && v.version.split(".").length === 2
    );
    const editVersions = versions.filter(
      (v) => v.version.split(".").length === 3
    );

    // Build minor children
    const minorNodes: VersionTreeNode[] = [];

    // Group edits by their minor version
    const editsByMinor = new Map<string, T[]>();
    for (const ev of editVersions) {
      const parts = ev.version.split(".");
      const minorKey = `${parts[0]}.${parts[1]}`;
      const existing = editsByMinor.get(minorKey) ?? [];
      existing.push(ev);
      editsByMinor.set(minorKey, existing);
    }

    for (const mv of minorVersions) {
      const editsForMinor = editsByMinor.get(mv.version) ?? [];
      minorNodes.push({
        version: mv.version,
        versionType: mv.versionType,
        timestamp: mv.timestamp,
        data: mv,
        children: editsForMinor.map((ev) => ({
          version: ev.version,
          versionType: ev.versionType,
          timestamp: ev.timestamp,
          data: ev,
          children: [],
        })),
      });
    }

    // Also check for edits on the major version directly (e.g., V1.0.1)
    const editsOnMajor = editVersions.filter((ev) => {
      const parts = ev.version.split(".");
      return parts[1] === "0";
    });

    if (majorVersion) {
      tree.push({
        version: majorVersion.version,
        versionType: majorVersion.versionType,
        timestamp: majorVersion.timestamp,
        data: majorVersion,
        children: [
          ...editsOnMajor.map((ev) => ({
            version: ev.version,
            versionType: ev.versionType,
            timestamp: ev.timestamp,
            data: ev,
            children: [],
          })),
          ...minorNodes,
        ],
      });
    } else if (minorNodes.length > 0) {
      // No major version node, just minors
      for (const mn of minorNodes) {
        tree.push(mn);
      }
    }
  }

  return tree;
}

const VERSION_TYPE_COLORS = {
  generate: "text-emerald-400",
  rewrite: "text-sky-400",
  edit: "text-amber-400",
};

const VERSION_TYPE_BG_COLORS = {
  generate: "bg-emerald-400",
  rewrite: "bg-sky-400",
  edit: "bg-amber-400",
};

const VERSION_TYPE_LABELS = {
  generate: "Gen",
  rewrite: "Rewrite",
  edit: "Edit",
};

function VersionNode({
  node,
  currentVersion,
  pinnedVersion,
  depth,
  onSelect,
  onPin,
  type,
  planVersions,
}: {
  node: VersionTreeNode;
  currentVersion: string | undefined;
  pinnedVersion: string | undefined;
  depth: number;
  onSelect: (version: string) => void;
  onPin: (version: string | undefined) => void;
  type: "prose" | "plan";
  planVersions?: PlanVersion[];
}) {
  const [expanded, setExpanded] = useState(true);
  const isActive = currentVersion === node.version;
  const isPinned = pinnedVersion === node.version;
  const hasChildren = node.children.length > 0;

  const date = new Date(node.timestamp);
  const timeStr = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const dateStr = date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });

  // For prose versions, show the source plan version
  const sourcePlanVersion =
    type === "prose" ? (node.data as ProseVersion).sourcePlanVersion : undefined;

  return (
    <div className="select-none">
      <div
        className={`group flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
          isActive
            ? "bg-white/10 text-text-primary"
            : isPinned
              ? "bg-white/5 text-text-secondary ring-1 ring-inset ring-white/20"
              : "hover:bg-white/5 text-text-secondary"
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onSelect(node.version)}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="w-4 h-4 flex items-center justify-center text-text-dim hover:text-text-secondary text-[8px]"
          >
            {expanded ? "\u25BC" : "\u25B6"}
          </button>
        ) : (
          <span className="w-4" />
        )}

        <span
          className={`text-[11px] font-mono font-semibold ${VERSION_TYPE_COLORS[node.versionType]}`}
        >
          V{node.version}
        </span>

        <span className="text-[9px] text-text-dim/60">
          {VERSION_TYPE_LABELS[node.versionType]}
        </span>

        {sourcePlanVersion && (
          <span className="text-[8px] text-text-dim/40" title={`Generated from Plan V${sourcePlanVersion}`}>
            {"\u2190"} P{sourcePlanVersion}
          </span>
        )}

        <span className="ml-auto text-[9px] text-text-dim/40">
          {dateStr} {timeStr}
        </span>

        {/* Pin/Unpin button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPin(isPinned ? undefined : node.version);
          }}
          className={`w-5 h-5 flex items-center justify-center rounded transition-all ${
            isPinned
              ? "text-amber-400 bg-amber-400/10"
              : "text-text-dim/30 opacity-0 group-hover:opacity-100 hover:text-amber-400 hover:bg-white/5"
          }`}
          title={isPinned ? "Unpin version" : "Pin this version for current branch"}
        >
          {"\u25C9"}
        </button>
      </div>

      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <VersionNode
              key={child.version}
              node={child}
              currentVersion={currentVersion}
              pinnedVersion={pinnedVersion}
              depth={depth + 1}
              onSelect={onSelect}
              onPin={onPin}
              type={type}
              planVersions={planVersions}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function VersionHistoryTree({
  versions,
  currentVersion,
  pinnedVersion,
  onSelectVersion,
  onPinVersion,
  type,
  planVersions,
}: {
  versions: ProseVersion[] | PlanVersion[];
  currentVersion: string | undefined;
  pinnedVersion: string | undefined;
  onSelectVersion: (version: string) => void;
  onPinVersion: (version: string | undefined) => void;
  type: "prose" | "plan";
  planVersions?: PlanVersion[];
}) {
  const tree = useMemo(
    () => buildVersionTree(versions as (ProseVersion | PlanVersion)[]),
    [versions],
  );

  if (versions.length === 0) {
    return (
      <div className="text-[11px] text-text-dim/60 py-4 text-center">
        No version history yet
      </div>
    );
  }

  return (
    <div className="py-2">
      <div className="flex items-center gap-2 px-3 mb-2">
        <span className="text-[10px] uppercase tracking-wider text-text-dim/60">
          {type === "prose" ? "Prose" : "Plan"} Versions
        </span>
        <span className="text-[9px] text-text-dim/40">({versions.length})</span>
        {pinnedVersion && (
          <span className="text-[9px] text-amber-400/60 ml-auto">
            Pinned: V{pinnedVersion}
          </span>
        )}
      </div>

      <div className="space-y-0.5 max-h-64 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
        {tree.map((node) => (
          <VersionNode
            key={node.version}
            node={node}
            currentVersion={currentVersion}
            pinnedVersion={pinnedVersion}
            depth={0}
            onSelect={onSelectVersion}
            onPin={onPinVersion}
            type={type}
            planVersions={planVersions}
          />
        ))}
      </div>

      <div className="flex items-center gap-3 mt-3 px-3 pt-2 border-t border-white/5">
        <div className="flex items-center gap-1">
          <span className={`w-2 h-2 rounded-full ${VERSION_TYPE_BG_COLORS.generate}`} />
          <span className="text-[9px] text-text-dim/60">Generate</span>
        </div>
        <div className="flex items-center gap-1">
          <span className={`w-2 h-2 rounded-full ${VERSION_TYPE_BG_COLORS.rewrite}`} />
          <span className="text-[9px] text-text-dim/60">Rewrite</span>
        </div>
        <div className="flex items-center gap-1">
          <span className={`w-2 h-2 rounded-full ${VERSION_TYPE_BG_COLORS.edit}`} />
          <span className="text-[9px] text-text-dim/60">Edit</span>
        </div>
      </div>
    </div>
  );
}

/** Compact version badge for displaying current version */
export function VersionBadge({
  version,
  versionType,
  isPinned,
  onClick,
}: {
  version: string | undefined;
  versionType?: "generate" | "rewrite" | "edit";
  isPinned?: boolean;
  onClick?: () => void;
}) {
  if (!version) return null;

  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-mono transition-colors ${
        onClick ? "hover:bg-white/10 cursor-pointer" : ""
      } ${isPinned ? "ring-1 ring-inset ring-amber-400/40" : ""}`}
    >
      <span className={versionType ? VERSION_TYPE_COLORS[versionType] : "text-text-dim"}>
        V{version}
      </span>
      {isPinned && <span className="text-amber-400">{"\u25C9"}</span>}
    </button>
  );
}
