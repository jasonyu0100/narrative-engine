'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useStore, ANALYSIS_NARRATIVE_IDS, PLAYGROUND_NARRATIVE_IDS } from '@/lib/store';
import { ArchetypeIcon } from '@/components/ArchetypeIcon';
import type { NarrativeState, Branch } from '@/types/narrative';
import { resolveEntry, isScene, type Scene } from '@/types/narrative';
import { computeRawForceTotals, computeSwingMagnitudes, computeForceSnapshots, computeDeliveryCurve, classifyNarrativeShape, classifyArchetype, classifyScale, classifyWorldDensity, gradeForces, FORCE_REFERENCE_MEANS, resolveEntrySequence, resolvePlanForBranch, resolveProseForBranch } from '@/lib/narrative-utils';
import { ApiLogsModal } from '@/components/topbar/ApiLogsModal';
import ApiKeyModal from '@/components/topbar/ApiKeyModal';
import SystemLogModal from '@/components/topbar/SystemLogModal';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import { CubeExplorer } from '@/components/topbar/CubeExplorer';
import { BranchContextModal } from '@/components/topbar/BranchContextModal';
import { FormulaModal } from '@/components/topbar/FormulaModal';
import { DefinitionsModal } from '@/components/topbar/DefinitionsModal';
import { PropositionAnalysisModal } from '@/components/topbar/PropositionAnalysisModal';
import { SlidesPlayer } from '@/components/slides/SlidesPlayer';
import { NarrativeReport } from '@/components/report/NarrativeReport';
import { MarkovChainModal } from '@/components/topbar/MarkovChainModal';
import { BeatProfileModal } from '@/components/topbar/BeatProfileModal';
import { ThreadGraphModal } from '@/components/topbar/ThreadGraphModal';
import { NarrativeEditModal } from '@/components/topbar/NarrativeEditModal';
import { UsageDropdown, computeTotalCost } from '@/components/topbar/UsageAnalyticsModal';
import { RegenerateEmbeddingsModal } from '@/components/topbar/RegenerateEmbeddingsModal';
import { ExportPackageModal } from '@/components/topbar/ExportPackageModal';
import { ImportPackageModal } from '@/components/topbar/ImportPackageModal';
import type { NarrativeEntry } from '@/types/narrative';
import { IconChevronDown, IconChevronRight, IconPlus, IconImport, IconSettings, IconDownload, IconFork, IconDocument, IconDollar, IconScorecard, IconBook } from '@/components/icons';
import { NowPlayingPill } from '@/components/canvas/AudioMiniPlayer';
import { exportEpub } from '@/lib/epub-export';
import { assetManager } from '@/lib/asset-manager';
import Image from 'next/image';


function downloadJson(data: object, filename: string) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportNarrative(narrative: NarrativeState) {
  downloadJson(narrative, `${narrative.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`);
}

/** Export a single branch as a self-contained NarrativeState with only the entries in that branch's timeline */
function exportBranch(narrative: NarrativeState, branchId: string) {
  const resolvedKeys = resolveEntrySequence(narrative.branches, branchId);
  const resolvedSet = new Set(resolvedKeys);

  // Collect only scenes and world builds on this branch's timeline
  const scenes: NarrativeState['scenes'] = {};
  const worldBuilds: NarrativeState['worldBuilds'] = {};
  const referencedCharIds = new Set<string>();
  const referencedLocIds = new Set<string>();
  const referencedThreadIds = new Set<string>();
  const referencedArcIds = new Set<string>();
  const referencedArtifactIds = new Set<string>();

  for (const key of resolvedKeys) {
    const scene = narrative.scenes[key];
    if (scene) {
      scenes[key] = scene;
      referencedCharIds.add(scene.povId);
      for (const pid of scene.participantIds) referencedCharIds.add(pid);
      referencedLocIds.add(scene.locationId);
      for (const tm of scene.threadMutations) referencedThreadIds.add(tm.threadId);
      for (const cm of scene.continuityMutations) referencedCharIds.add(cm.entityId);
      for (const rm of scene.relationshipMutations) { referencedCharIds.add(rm.from); referencedCharIds.add(rm.to); }
      if (scene.characterMovements) {
        for (const [cid, mv] of Object.entries(scene.characterMovements)) {
          referencedCharIds.add(cid);
          referencedLocIds.add(mv.locationId);
        }
      }
      for (const om of scene.ownershipMutations ?? []) referencedArtifactIds.add(om.artifactId);
      // Find arc containing this scene
      for (const [arcId, arc] of Object.entries(narrative.arcs)) {
        if (arc.sceneIds.includes(key)) referencedArcIds.add(arcId);
      }
    }
    const wb = narrative.worldBuilds[key];
    if (wb) worldBuilds[key] = wb;
  }

  // Also collect entities from world build expansion manifests
  for (const wb of Object.values(worldBuilds)) {
    const m = wb.expansionManifest;
    if (m) {
      for (const c of m.characters ?? []) referencedCharIds.add(c.id);
      for (const l of m.locations ?? []) referencedLocIds.add(l.id);
      for (const t of m.threads ?? []) referencedThreadIds.add(t.id);
      for (const a of m.artifacts ?? []) referencedArtifactIds.add(a.id);
    }
  }

  // Add parent locations to maintain hierarchy
  for (const locId of [...referencedLocIds]) {
    let current = narrative.locations[locId];
    while (current?.parentId && !referencedLocIds.has(current.parentId)) {
      referencedLocIds.add(current.parentId);
      current = narrative.locations[current.parentId];
    }
  }

  // Build filtered entity catalogs
  const characters: NarrativeState['characters'] = {};
  for (const id of referencedCharIds) if (narrative.characters[id]) characters[id] = narrative.characters[id];

  const locations: NarrativeState['locations'] = {};
  for (const id of referencedLocIds) if (narrative.locations[id]) locations[id] = narrative.locations[id];

  const threads: NarrativeState['threads'] = {};
  for (const id of referencedThreadIds) if (narrative.threads[id]) threads[id] = narrative.threads[id];

  const artifacts: NarrativeState['artifacts'] = {};
  for (const id of referencedArtifactIds) if (narrative.artifacts?.[id]) artifacts[id] = narrative.artifacts[id];

  const arcs: NarrativeState['arcs'] = {};
  for (const id of referencedArcIds) if (narrative.arcs[id]) arcs[id] = narrative.arcs[id];

  // Filter relationships to only those between referenced characters
  const relationships = narrative.relationships.filter(
    (r) => referencedCharIds.has(r.from) && referencedCharIds.has(r.to)
  );

  // Build the branch chain — include this branch and its ancestors
  const branch = narrative.branches[branchId];
  const branches: NarrativeState['branches'] = {};

  // Flatten into a single root branch for the export
  const exportBranchObj: Branch = {
    id: branchId,
    name: branch?.name ?? 'main',
    parentBranchId: null,
    forkEntryId: null,
    entryIds: resolvedKeys,
    planningQueue: branch?.planningQueue,
    createdAt: branch?.createdAt ?? Date.now(),
  };
  branches[branchId] = exportBranchObj;

  const exported: NarrativeState = {
    id: narrative.id,
    title: narrative.title,
    description: narrative.description,
    characters,
    locations,
    threads,
    artifacts,
    arcs,
    scenes,
    worldBuilds,
    branches,
    relationships,
    worldKnowledge: narrative.worldKnowledge,
    worldSummary: narrative.worldSummary,
    rules: narrative.rules,
    worldSystems: narrative.worldSystems,
    storySettings: narrative.storySettings,
    imageStyle: narrative.imageStyle,
    coverImageUrl: narrative.coverImageUrl,
    structureReviews: narrative.structureReviews?.[branchId]
      ? { [branchId]: narrative.structureReviews[branchId] }
      : undefined,
    createdAt: narrative.createdAt,
    updatedAt: narrative.updatedAt,
  };

  const branchName = branch?.name ?? 'main';
  const filename = `${narrative.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${branchName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
  downloadJson(exported, filename);
}

// ── Menu Dropdown ────────────────────────────────────────────────────────────

type MenuItem = {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  indicator?: React.ReactNode;
};

function MenuDropdown({
  label,
  items,
  openMenu,
  setOpenMenu,
  menuKey,
  anyMenuOpen,
}: {
  label: string;
  items: MenuItem[];
  openMenu: string | null;
  setOpenMenu: (key: string | null) => void;
  menuKey: string;
  anyMenuOpen: boolean;
}) {
  const isOpen = openMenu === menuKey;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen, setOpenMenu]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpenMenu(isOpen ? null : menuKey)}
        onMouseEnter={() => { if (anyMenuOpen) setOpenMenu(menuKey); }}
        className={`px-2.5 py-1 text-[12px] rounded transition-colors ${
          isOpen
            ? 'bg-white/10 text-text-primary'
            : 'text-text-secondary hover:bg-white/5 hover:text-text-primary'
        }`}
      >
        {label}
      </button>
      {isOpen && (
        <div
          className="absolute top-full left-0 mt-1 min-w-[200px] rounded-lg border border-white/10 py-1 z-50"
          style={{
            background: '#1a1a1a',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)',
          }}
        >
          {items.map((item, i) => (
            <button
              key={i}
              onClick={() => {
                if (item.disabled) return;
                item.onClick();
                setOpenMenu(null);
              }}
              disabled={item.disabled}
              className={`w-full flex items-center justify-between px-3 py-1.5 text-[12px] transition-colors ${
                item.disabled
                  ? 'text-text-dim/40 cursor-default'
                  : 'text-text-secondary hover:text-text-primary hover:bg-white/5'
              }`}
            >
              <span className="flex items-center gap-2">
                {item.label}
                {item.indicator}
              </span>
              {item.shortcut && (
                <span className="text-[10px] text-text-dim/50 ml-4 font-mono">{item.shortcut}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main TopBar ──────────────────────────────────────────────────────────────

export default function TopBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [editingEntry, setEditingEntry] = useState<NarrativeEntry | null>(null);
  const [pickerSections, setPickerSections] = useState<Record<string, boolean>>({ projects: true, works: false, playground: false });
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const access = useFeatureAccess();

  // Modal states
  const [logsOpen, setLogsOpen] = useState(false);
  const [apiKeysOpen, setApiKeysOpen] = useState(false);
  const [systemLogsOpen, setSystemLogsOpen] = useState(false);

  const [cubeExplorerOpen, setCubeExplorerOpen] = useState(false);
  const [branchContextOpen, setBranchContextOpen] = useState(false);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [definitionsOpen, setDefinitionsOpen] = useState(false);
  const [slidesOpen, setSlidesOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [markovOpen, setMarkovOpen] = useState(false);
  const [beatProfileOpen, setBeatProfileOpen] = useState(false);
  const [propositionAnalysisOpen, setPropositionAnalysisOpen] = useState(false);
  const [threadGraphOpen, setThreadGraphOpen] = useState(false);
  const [scorecardOpen, setScorecardOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPackageOpen, setExportPackageOpen] = useState(false);
  const [importPackageOpen, setImportPackageOpen] = useState(false);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [hoveredArcIdx, setHoveredArcIdx] = useState<number | null>(null);
  const [scorecardGraphView, setScorecardGraphView] = useState<'arcs' | 'delivery'>('arcs');
  const scorecardRef = useRef<HTMLDivElement>(null);
  const usageRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Auto-open slides when ?slides=1 is in the URL (fresh analysis or works seed)
  useEffect(() => {
    if (searchParams.get('slides') === '1' && narrative) {
      setSlidesOpen(true);
      router.replace(`/series/${narrative.id}`, { scroll: false });
    }
  }, [searchParams, narrative, router]);

  useEffect(() => {
    function handleOpenApiKeys() { setApiKeysOpen(true); }
    window.addEventListener('open-api-keys', handleOpenApiKeys);
    return () => window.removeEventListener('open-api-keys', handleOpenApiKeys);
  }, []);

  const activeArc = narrative
    ? Object.values(narrative.arcs).find((a) =>
        a.sceneIds.includes(
          state.resolvedEntryKeys[state.currentSceneIndex] ?? ''
        )
      )
    : null;

  useEffect(() => {
    if (!selectorOpen) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSelectorOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [selectorOpen]);

  // Close scorecard / usage / export on outside click
  useEffect(() => {
    if (!scorecardOpen && !usageOpen && !exportOpen) return;
    function handleClick(e: MouseEvent) {
      if (scorecardOpen && scorecardRef.current && !scorecardRef.current.contains(e.target as Node)) {
        setScorecardOpen(false);
      }
      if (usageOpen && usageRef.current && !usageRef.current.contains(e.target as Node)) {
        setUsageOpen(false);
      }
      if (exportOpen && exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [scorecardOpen, usageOpen, exportOpen]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!copyToast) return;
    const t = setTimeout(() => setCopyToast(null), 2000);
    return () => clearTimeout(t);
  }, [copyToast]);

  // Copy/export helpers
  const copyAllText = useCallback((mode: 'prose' | 'plan' | 'summary') => {
    if (!narrative || !state.activeBranchId) return;
    const scenes = state.resolvedEntryKeys
      .map((k) => resolveEntry(narrative, k))
      .filter((e): e is Scene => !!e && isScene(e));

    const branches = narrative.branches;
    const branchId = state.activeBranchId;

    const parts: string[] = [];
    for (const scene of scenes) {
      if (mode === 'prose') {
        const { prose } = resolveProseForBranch(scene, branchId, branches);
        if (prose) parts.push(prose);
      } else if (mode === 'plan') {
        const plan = resolvePlanForBranch(scene, branchId, branches);
        if (plan) {
          const beats = plan.beats.map((b) => {
            const props = b.propositions.map(p => p.content).join('; ');
            return `[${b.fn}/${b.mechanism}] ${b.what}${props ? ` — ${props}` : ''}`;
          }).join('\n');
          parts.push(`Scene: ${scene.summary}\n${beats}`);
        }
      } else {
        parts.push(scene.summary);
      }
    }

    const text = parts.join('\n\n---\n\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopyToast(`Copied ${parts.length} ${mode === 'prose' ? 'scenes' : mode === 'plan' ? 'plans' : 'summaries'}`);
    });
    setExportOpen(false);
  }, [narrative, state.resolvedEntryKeys, state.activeBranchId]);

  const handleExportEpub = useCallback(() => {
    if (!narrative || !state.activeBranchId) return;
    exportEpub(narrative, state.resolvedEntryKeys, state.activeBranchId, {});
    setExportOpen(false);
  }, [narrative, state.resolvedEntryKeys, state.activeBranchId]);

  const handleExportAudio = useCallback(async () => {
    if (!narrative) return;
    setExportOpen(false);
    const scenes = state.resolvedEntryKeys
      .map((k) => resolveEntry(narrative, k))
      .filter((e): e is Scene => !!e && isScene(e))
      .filter((s) => s.audioUrl);

    if (scenes.length === 0) {
      setCopyToast('No audio to export');
      return;
    }

    await assetManager.init();
    const blobs: { name: string; blob: Blob }[] = [];
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      if (!scene.audioUrl) continue;
      try {
        const blob = await assetManager.getAudio(scene.audioUrl);
        if (blob) {
          const arcName = Object.values(narrative.arcs).find((a) => a.sceneIds.includes(scene.id))?.name ?? 'Untitled';
          blobs.push({ name: `${String(i + 1).padStart(3, '0')}_${arcName.replace(/[^a-z0-9]/gi, '_')}.mp3`, blob });
        }
      } catch { /* skip */ }
    }

    if (blobs.length === 0) {
      setCopyToast('No audio blobs found');
      return;
    }

    // Single file — download directly
    if (blobs.length === 1) {
      const url = URL.createObjectURL(blobs[0].blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = blobs[0].name;
      a.click();
      URL.revokeObjectURL(url);
      setCopyToast('Exported 1 audio file');
      return;
    }

    // Multiple — concatenate into one blob download
    const allParts: BlobPart[] = [];
    for (const b of blobs) allParts.push(b.blob);
    const combined = new Blob(allParts, { type: 'audio/mpeg' });
    const url = URL.createObjectURL(combined);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${narrative.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_audio.mp3`;
    a.click();
    URL.revokeObjectURL(url);
    setCopyToast(`Exported ${blobs.length} audio scenes`);
  }, [narrative, state.resolvedEntryKeys]);

  // Usage: filter logs to current narrative
  const handleCopyCurrentEntryJson = useCallback(async () => {
    if (!narrative) {
      setCopyToast('No narrative');
      return;
    }

    // Check if we have a scene selected in inspector
    if (state.inspectorContext?.type === 'scene') {
      const scene = narrative.scenes[state.inspectorContext.sceneId];
      if (!scene) {
        setCopyToast('Scene not found');
        return;
      }
      try {
        await navigator.clipboard.writeText(JSON.stringify(scene, null, 2));
        setExportOpen(false);
        setCopyToast('Scene JSON copied');
      } catch (err) {
        setCopyToast('Failed to copy');
      }
      return;
    }

    // Otherwise, find the most recent world build
    let worldBuild: any = null;
    for (let i = state.resolvedEntryKeys.length - 1; i >= 0; i--) {
      const key = state.resolvedEntryKeys[i];
      const entry = resolveEntry(narrative, key);
      if (entry && !isScene(entry)) {
        worldBuild = entry;
        break;
      }
    }

    if (!worldBuild) {
      setCopyToast('No world commit found');
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(worldBuild, null, 2));
      setExportOpen(false);
      setCopyToast('World commit JSON copied');
    } catch (err) {
      setCopyToast('Failed to copy');
    }
  }, [narrative, state.inspectorContext, state.resolvedEntryKeys]);

  const handleCopyFullJson = useCallback(async () => {
    if (!narrative) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(narrative, null, 2));
      setExportOpen(false);
      setCopyToast('Narrative JSON copied');
    } catch (err) {
      setCopyToast('Failed to copy');
    }
  }, [narrative]);

  const handleCopyBranchJson = useCallback(async () => {
    if (!narrative || !state.activeBranchId) return;
    const resolvedKeys = resolveEntrySequence(narrative.branches, state.activeBranchId);
    const resolvedSet = new Set(resolvedKeys);

    // Collect only scenes and world builds on this branch's timeline
    const scenes: NarrativeState['scenes'] = {};
    const worldBuilds: NarrativeState['worldBuilds'] = {};
    const referencedCharIds = new Set<string>();
    const referencedLocIds = new Set<string>();
    const referencedThreadIds = new Set<string>();
    const referencedArcIds = new Set<string>();
    const referencedArtifactIds = new Set<string>();

    for (const key of resolvedKeys) {
      const scene = narrative.scenes[key];
      if (scene) {
        scenes[key] = scene;
        referencedCharIds.add(scene.povId);
        for (const pid of scene.participantIds) referencedCharIds.add(pid);
        referencedLocIds.add(scene.locationId);
        for (const tm of scene.threadMutations) referencedThreadIds.add(tm.threadId);
        for (const cm of scene.continuityMutations) referencedCharIds.add(cm.entityId);
        for (const rm of scene.relationshipMutations) { referencedCharIds.add(rm.from); referencedCharIds.add(rm.to); }
        if (scene.characterMovements) {
          for (const [cid, mv] of Object.entries(scene.characterMovements)) {
            referencedCharIds.add(cid);
            referencedLocIds.add(mv.locationId);
          }
        }
        for (const om of scene.ownershipMutations ?? []) referencedArtifactIds.add(om.artifactId);
        for (const [arcId, arc] of Object.entries(narrative.arcs)) {
          if (arc.sceneIds.includes(key)) referencedArcIds.add(arcId);
        }
      }
      const wb = narrative.worldBuilds[key];
      if (wb) worldBuilds[key] = wb;
    }

    for (const wb of Object.values(worldBuilds)) {
      const m = wb.expansionManifest;
      if (m) {
        for (const c of m.characters ?? []) referencedCharIds.add(c.id);
        for (const l of m.locations ?? []) referencedLocIds.add(l.id);
        for (const t of m.threads ?? []) referencedThreadIds.add(t.id);
        for (const a of m.artifacts ?? []) referencedArtifactIds.add(a.id);
      }
    }

    for (const locId of [...referencedLocIds]) {
      let current = narrative.locations[locId];
      while (current?.parentId && !referencedLocIds.has(current.parentId)) {
        referencedLocIds.add(current.parentId);
        current = narrative.locations[current.parentId];
      }
    }

    const characters: NarrativeState['characters'] = {};
    for (const id of referencedCharIds) if (narrative.characters[id]) characters[id] = narrative.characters[id];

    const locations: NarrativeState['locations'] = {};
    for (const id of referencedLocIds) if (narrative.locations[id]) locations[id] = narrative.locations[id];

    const threads: NarrativeState['threads'] = {};
    for (const id of referencedThreadIds) if (narrative.threads[id]) threads[id] = narrative.threads[id];

    const artifacts: NarrativeState['artifacts'] = {};
    for (const id of referencedArtifactIds) if (narrative.artifacts?.[id]) artifacts[id] = narrative.artifacts[id];

    const arcs: NarrativeState['arcs'] = {};
    for (const id of referencedArcIds) if (narrative.arcs[id]) arcs[id] = narrative.arcs[id];

    const relationships = narrative.relationships.filter(
      (r) => referencedCharIds.has(r.from) && referencedCharIds.has(r.to)
    );

    const branch = narrative.branches[state.activeBranchId];
    const branches: NarrativeState['branches'] = {};

    const exportBranchObj: Branch = {
      id: state.activeBranchId,
      name: branch?.name ?? 'main',
      parentBranchId: null,
      forkEntryId: null,
      entryIds: resolvedKeys,
      planningQueue: branch?.planningQueue,
      createdAt: branch?.createdAt ?? Date.now(),
    };
    branches[state.activeBranchId] = exportBranchObj;

    const exported: NarrativeState = {
      id: narrative.id,
      title: narrative.title,
      description: narrative.description,
      characters,
      locations,
      threads,
      artifacts,
      arcs,
      scenes,
      worldBuilds,
      branches,
      relationships,
      worldKnowledge: narrative.worldKnowledge,
      worldSummary: narrative.worldSummary,
      rules: narrative.rules,
      worldSystems: narrative.worldSystems,
      storySettings: narrative.storySettings,
      imageStyle: narrative.imageStyle,
      coverImageUrl: narrative.coverImageUrl,
      structureReviews: narrative.structureReviews?.[state.activeBranchId]
        ? { [state.activeBranchId]: narrative.structureReviews[state.activeBranchId] }
        : undefined,
      createdAt: narrative.createdAt,
      updatedAt: narrative.updatedAt,
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(exported, null, 2));
      setExportOpen(false);
      setCopyToast('Branch JSON copied');
    } catch (err) {
      setCopyToast('Failed to copy');
    }
  }, [narrative, state.activeBranchId]);

  const narrativeLogs = useMemo(() =>
    state.activeNarrativeId
      ? state.apiLogs.filter(l => l.narrativeId === state.activeNarrativeId)
      : state.apiLogs,
    [state.apiLogs, state.activeNarrativeId],
  );
  const usageCost = useMemo(() => computeTotalCost(narrativeLogs), [narrativeLogs]);

  // Scorecard data
  const allScenes = useMemo(() => {
    if (!narrative) return [];
    return state.resolvedEntryKeys
      .map((k) => resolveEntry(narrative, k))
      .filter((e): e is Scene => !!e && isScene(e));
  }, [narrative, state.resolvedEntryKeys]);

  // Export availability flags
  const exportAvailability = useMemo(() => {
    if (!narrative || !state.activeBranchId) {
      return { hasProse: false, hasPlans: false, hasSummaries: false, hasAudio: false };
    }
    const branches = narrative.branches;
    const branchId = state.activeBranchId;
    return {
      hasProse: allScenes.some((s) => !!resolveProseForBranch(s, branchId, branches).prose),
      hasPlans: allScenes.some((s) => !!resolvePlanForBranch(s, branchId, branches)),
      hasSummaries: allScenes.some((s) => s.summary),
      hasAudio: allScenes.some((s) => s.audioUrl),
    };
  }, [allScenes, narrative, state.activeBranchId]);

  const scorecard = useMemo(() => {
    if (allScenes.length === 0 || !narrative) return null;
    const raw = computeRawForceTotals(allScenes);
    const n = raw.drive.length;
    if (n === 0) return null;

    const sum = (arr: number[]) => arr.reduce((s, v) => s + v, 0);
    const avg = (arr: number[]) => sum(arr) / arr.length;
    const max = (arr: number[]) => Math.max(...arr);
    const std = (arr: number[]) => {
      const m = avg(arr);
      return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
    };

    const rawForces = raw.drive.map((_, i) => ({
      drive: raw.drive[i],
      world: raw.world[i],
      system: raw.system[i],
    }));
    const swings = computeSwingMagnitudes(rawForces, FORCE_REFERENCE_MEANS);

    const forceStats = (arr: number[]) => ({
      total: sum(arr),
      avg: avg(arr),
      max: max(arr),
      std: std(arr),
    });

    const stats = {
      drive: forceStats(raw.drive),
      world: forceStats(raw.world),
      system: forceStats(raw.system),
      swing: forceStats(swings),
    };

    const arcCount = Object.keys(narrative.arcs).length;

    const sceneIdToIdx = new Map(allScenes.map((s, i) => [s.id, i]));
    const arcsInOrder = Object.values(narrative.arcs);
    const perArc = arcsInOrder
      .map((arc) => {
        const forceIndices = arc.sceneIds
          .map((sid) => sceneIdToIdx.get(sid))
          .filter((i): i is number => i !== undefined);
        if (forceIndices.length === 0) return null;

        const arcDrives = forceIndices.map((i) => raw.drive[i]);
        const arcWorlds = forceIndices.map((i) => raw.world[i]);
        const arcSystem = forceIndices.map((i) => raw.system[i]);
        const arcSwingVals = forceIndices.map((i, idx) => idx === 0 ? 0 : swings[i]);

        return {
          name: arc.name,
          scenes: forceIndices.length,
          grades: gradeForces(arcDrives, arcWorlds, arcSystem, arcSwingVals),
        };
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);

    const seriesGrades = gradeForces(raw.drive, raw.world, raw.system, swings);

    const normSnapshots = Object.values(computeForceSnapshots(allScenes));
    const deliveryPoints = computeDeliveryCurve(normSnapshots);
    const shape = classifyNarrativeShape(deliveryPoints.map((d) => d.delivery));

    const archetype = classifyArchetype(seriesGrades);

    const scale = classifyScale(n);
    const charCount = Object.keys(narrative.characters).length;
    const locCount = Object.keys(narrative.locations).length;
    const threadCount = Object.keys(narrative.threads).length;
    const wkNodeCount = Object.keys(narrative.worldKnowledge?.nodes ?? {}).length;
    const density = classifyWorldDensity(n, charCount, locCount, threadCount, wkNodeCount);

    return {
      title: narrative.title,
      scenes: n,
      arcs: arcCount,
      ...stats,
      grades: seriesGrades,
      archetype,
      scale,
      density,
      perArc,
      shape,
      deliveryPoints,
    };
  }, [allScenes, narrative]);


  const hasNarrative = !!narrative;

  return (
    <div className="flex items-center justify-between h-11 glass-panel border-b border-border px-3">
      {/* Left: home + title + menus */}
      <div className="flex items-center gap-0.5 text-sm min-w-0">
        {/* Home button with logo */}
        <button
          onClick={() => router.push('/')}
          className="px-1.5 py-1 rounded hover:bg-bg-elevated transition-colors"
          title="All series"
        >
          <Image src="/logo.svg" alt="InkTide" width={20} height={20} />
        </button>

        {/* Narrative selector */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setSelectorOpen((o) => !o)}
            className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-bg-elevated transition-colors"
          >
            <span className="text-text-primary truncate max-w-50 text-[12px] font-medium">
              {narrative ? narrative.title : 'Select Narrative'}
            </span>
            <IconChevronDown size={12} className={`text-text-dim transition-transform ${selectorOpen ? 'rotate-180' : ''}`} />
          </button>

          {selectorOpen && (
            <div
              className="absolute top-full left-0 mt-1.5 w-72 rounded-xl border border-white/10 z-50 overflow-hidden"
              style={{ background: '#1a1a1a', boxShadow: '0 12px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)' }}
            >
              <div className="max-h-80 overflow-y-auto py-1.5">
                {state.narratives.length === 0 ? (
                  <p className="text-xs text-text-dim px-4 py-4 text-center">No narratives yet</p>
                ) : (() => {
                  const works = state.narratives.filter((n) => ANALYSIS_NARRATIVE_IDS.has(n.id));
                  const playground = state.narratives.filter((n) => PLAYGROUND_NARRATIVE_IDS.has(n.id));
                  const projects = state.narratives.filter((n) => !ANALYSIS_NARRATIVE_IDS.has(n.id) && !PLAYGROUND_NARRATIVE_IDS.has(n.id));
                  const sections = [
                    { key: 'projects', label: 'Projects', entries: projects },
                    { key: 'works', label: 'Works', entries: works },
                    { key: 'playground', label: 'Playground', entries: playground },
                  ].filter((s) => s.entries.length > 0);

                  return sections.map(({ key, label, entries }) => (
                    <div key={key}>
                      <button
                        onClick={() => setPickerSections((s) => ({ ...s, [key]: !s[key] }))}
                        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-left group"
                      >
                        <IconChevronRight size={7} className={`shrink-0 text-text-dim transition-transform ${pickerSections[key] ? 'rotate-90' : ''}`} />
                        <span className="text-[10px] font-semibold text-text-dim uppercase tracking-widest group-hover:text-text-secondary transition-colors">{label}</span>
                        <span className="text-[10px] text-text-dim ml-auto">{entries.length}</span>
                      </button>
                      {pickerSections[key] && entries.map((entry) => {
                        const isActive = state.activeNarrativeId === entry.id;
                        const isDeleting = deletingId === entry.id;
                        return (
                          <div key={entry.id}>
                            <div className={`flex items-center mx-1.5 rounded-lg transition-colors ${isActive ? 'bg-white/8' : 'hover:bg-white/5'}`}>
                              <button
                                onClick={() => { setSelectorOpen(false); router.push(`/series/${entry.id}`); }}
                                className="flex-1 text-left px-3 py-2 min-w-0"
                              >
                                <div className="text-[13px] text-text-primary truncate leading-snug">{entry.title}</div>
                                <div className="text-[11px] text-text-dim truncate mt-0.5 leading-snug">{entry.description}</div>
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); setDeletingId(isDeleting ? null : entry.id); setDeleteConfirm(''); }}
                                className="px-2.5 py-1 mr-1.5 text-text-dim hover:text-drive text-xs rounded transition-colors shrink-0 hover:bg-white/5"
                                title="Delete narrative"
                              >
                                &times;
                              </button>
                            </div>
                            {isDeleting && (
                              <div className="mx-1.5 px-3 py-2.5 mb-1 rounded-lg" style={{ background: 'rgba(239,68,68,0.06)' }}>
                                <p className="text-[10px] text-text-dim mb-1.5">
                                  Type <span className="text-text-secondary font-medium">{entry.title}</span> to confirm
                                </p>
                                <input
                                  type="text"
                                  value={deleteConfirm}
                                  onChange={(e) => setDeleteConfirm(e.target.value)}
                                  placeholder={entry.title}
                                  className="bg-white/5 border border-white/8 rounded-md px-2.5 py-1.5 text-xs text-text-primary w-full outline-none placeholder:text-text-dim/30 mb-2 focus:border-white/15 transition-colors"
                                  autoFocus
                                />
                                <button
                                  onClick={() => {
                                    if (deleteConfirm === entry.title) {
                                      dispatch({ type: 'DELETE_NARRATIVE', id: entry.id });
                                      setDeletingId(null);
                                      setDeleteConfirm('');
                                      if (isActive) router.push('/');
                                    }
                                  }}
                                  disabled={deleteConfirm !== entry.title}
                                  className="w-full text-xs font-medium py-1.5 rounded-md transition-colors bg-drive/20 text-drive hover:bg-drive/30 disabled:opacity-30 disabled:pointer-events-none"
                                >
                                  Delete permanently
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ));
                })()}
              </div>
              {/* ── Actions ── */}
              <div className="border-t border-white/8 px-3 py-2">
                <div className="flex gap-1.5">
                  <button
                    onClick={() => { dispatch({ type: 'OPEN_WIZARD' }); setSelectorOpen(false); }}
                    className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors border border-white/6"
                  >
                    <IconPlus size={10} />
                    New
                  </button>
                  <div className="flex rounded-md border border-white/6 overflow-hidden">
                    <button
                      onClick={() => { setImportPackageOpen(true); setSelectorOpen(false); }}
                      className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors"
                    >
                      <IconImport size={10} />
                      Import
                    </button>
                    {narrative && (
                      <>
                        <div className="w-px bg-white/6" />
                        <button
                          onClick={() => { setExportPackageOpen(true); setSelectorOpen(false); }}
                          className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors"
                        >
                          <IconDownload size={10} />
                          Export
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Current narrative options ── */}
              {narrative && (
                <div className="border-t border-white/8 py-1">
                  <div className="px-3 pt-1.5 pb-1">
                    <span className="text-[9px] font-semibold text-text-dim uppercase tracking-widest">Current Story</span>
                  </div>
                  {(() => {
                    const activeEntry = state.narratives.find((n) => n.id === narrative.id);
                    return activeEntry ? (
                      <button
                        onClick={() => { setEditingEntry(activeEntry); setSelectorOpen(false); }}
                        className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[12px] text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors"
                      >
                        <IconSettings size={12} className="text-text-dim shrink-0" />
                        Settings
                      </button>
                    ) : null;
                  })()}

                </div>
              )}
            </div>
          )}
        </div>


        {/* Divider */}
        <div className="w-px h-4 bg-white/8 mx-1.5" />

        {/* Menu bar */}
        <MenuDropdown
          label="View"
          menuKey="view"
          openMenu={openMenu}
          setOpenMenu={setOpenMenu}
          anyMenuOpen={openMenu !== null}
          items={[
            { label: 'Slides', onClick: () => setSlidesOpen(true), disabled: !hasNarrative },
            { label: 'Scorecard', onClick: () => setScorecardOpen((v) => !v), disabled: !hasNarrative },
            { label: 'Cast, Locations & Artefacts', onClick: () => window.dispatchEvent(new Event('open-cast-analytics')), disabled: !hasNarrative },
          ]}
        />

        <MenuDropdown
          label="Inspect"
          menuKey="inspect"
          openMenu={openMenu}
          setOpenMenu={setOpenMenu}
          anyMenuOpen={openMenu !== null}
          items={[
            { label: 'Force Analytics', onClick: () => window.dispatchEvent(new Event('open-force-analytics')), disabled: !hasNarrative },
            { label: 'Narrative Cube', onClick: () => window.dispatchEvent(new CustomEvent('open-cube-viewer')), disabled: !hasNarrative },
            { label: 'Thread Graph', onClick: () => setThreadGraphOpen(true), disabled: !hasNarrative },
            { label: 'Cube Explorer', onClick: () => setCubeExplorerOpen(true), disabled: !hasNarrative },
            { label: 'Pacing Profile', onClick: () => setMarkovOpen(true), disabled: !hasNarrative },
            { label: 'Beat Profile', onClick: () => setBeatProfileOpen(true), disabled: !hasNarrative },
            { label: 'Propositions', onClick: () => setPropositionAnalysisOpen(true), disabled: !hasNarrative },
            { label: 'Formulas', onClick: () => setFormulaOpen(true) },
            { label: 'Definitions', onClick: () => setDefinitionsOpen(true) },
          ]}
        />

        <MenuDropdown
          label="Config"
          menuKey="config"
          openMenu={openMenu}
          setOpenMenu={setOpenMenu}
          anyMenuOpen={openMenu !== null}
          items={[
            { label: 'Systems', onClick: () => window.dispatchEvent(new Event('open-world-systems-panel')), disabled: !hasNarrative },
            { label: 'Rules', onClick: () => window.dispatchEvent(new Event('open-rules-panel')), disabled: !hasNarrative },
            { label: 'Profile', onClick: () => window.dispatchEvent(new Event('open-prose-profile')), disabled: !hasNarrative },
          ]}
        />

        <MenuDropdown
          label="Debug"
          menuKey="debug"
          openMenu={openMenu}
          setOpenMenu={setOpenMenu}
          anyMenuOpen={openMenu !== null}
          items={[
            { label: 'LLM Context', onClick: () => setBranchContextOpen(true), disabled: !hasNarrative },
            { label: 'API Logs', onClick: () => setLogsOpen(true) },
            { label: 'Logging', onClick: () => setSystemLogsOpen(true) },
            ...(process.env.NEXT_PUBLIC_USER_API_KEYS === 'true'
              ? [{ label: 'API Keys', onClick: () => setApiKeysOpen(true) }]
              : []),
          ]}
        />
      </div>

      {/* Right: quick actions */}
      <div className="flex items-center gap-1.5">
        {/* Usage pill */}
        <div className="relative" ref={usageRef}>
          <button
            onClick={() => setUsageOpen((v) => !v)}
            className={`px-2.5 py-1 rounded-full transition-colors flex items-center gap-1.5 text-[12px] border ${
              usageOpen
                ? 'text-text-primary bg-white/10 border-white/15'
                : 'text-text-dim hover:text-text-primary hover:bg-white/5 border-white/8'
            }`}
            title="Usage Analytics"
          >
            <IconDollar size={14} />
            <span className="font-semibold font-mono text-emerald-400">
              {usageCost >= 1 ? `$${usageCost.toFixed(2)}` : usageCost >= 0.01 ? `$${usageCost.toFixed(3)}` : `$${usageCost.toFixed(4)}`}
            </span>
          </button>
          {usageOpen && <UsageDropdown logs={narrativeLogs} />}
        </div>

        {/* Scorecard pill */}
        <div className="relative" ref={scorecardRef}>
          {scorecard && (
            <button
              onClick={() => setScorecardOpen((v) => !v)}
              className={`px-2.5 py-1 rounded-full transition-colors flex items-center gap-1.5 text-[12px] border ${
                scorecardOpen
                  ? 'text-text-primary bg-white/10 border-white/15'
                  : 'text-text-dim hover:text-text-primary hover:bg-white/5 border-white/8'
              }`}
              title="Force Scorecard"
            >
              <IconScorecard size={14} />
              <span className={`font-semibold font-mono ${
                scorecard.grades.overall >= 90 ? 'text-green-400' :
                scorecard.grades.overall >= 80 ? 'text-lime-400' :
                scorecard.grades.overall >= 70 ? 'text-yellow-400' :
                scorecard.grades.overall >= 60 ? 'text-orange-400' : 'text-red-400'
              }`}>{scorecard.grades.overall}</span>
            </button>
          )}
          {scorecardOpen && !scorecard && (
            <div className="absolute top-full right-0 mt-1 z-50 bg-bg-base border border-white/10 rounded-lg shadow-2xl p-5 w-[420px]">
              <p className="text-[12px] text-text-dim text-center py-4">No scenes yet — generate some arcs to see scores.</p>
            </div>
          )}
          {scorecardOpen && scorecard && (
            <div className="absolute top-full right-0 mt-1 z-50 bg-bg-base border border-white/10 rounded-lg shadow-2xl p-5 w-[420px]">
              {/* Series header */}
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-[13px] font-semibold text-text-primary truncate max-w-[280px]">{scorecard.title}</h2>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`text-[22px] font-bold font-mono leading-none ${
                    scorecard.grades.overall >= 90 ? 'text-green-400' :
                    scorecard.grades.overall >= 80 ? 'text-lime-400' :
                    scorecard.grades.overall >= 70 ? 'text-yellow-400' :
                    scorecard.grades.overall >= 60 ? 'text-orange-400' : 'text-red-400'
                  }`}>{scorecard.grades.overall}</span>
                  <span className="text-[10px] text-text-dim font-mono">/100</span>
                </div>
              </div>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-[9px] text-text-dim font-mono">{scorecard.scenes} scenes</span>
                <span className="text-[9px] text-text-dim opacity-30">/</span>
                <span className="text-[9px] text-text-dim font-mono">{scorecard.arcs} arcs</span>
              </div>

              {/* Force table */}
              <div className="grid grid-cols-[auto_1fr_1fr_1fr_1fr_1fr] gap-px bg-white/5 rounded overflow-hidden">
                <div className="bg-bg-base p-2" />
                {['Avg', 'σ', 'Peak', 'Total', 'Grade'].map((col) => (
                  <div key={col} className="bg-bg-base p-2 text-center">
                    <span className={`text-[9px] tracking-wider text-text-dim font-mono ${col === 'σ' ? '' : 'uppercase'}`}>{col}</span>
                  </div>
                ))}
                {([
                  { key: 'drive' as const, label: 'Drive', color: '#EF4444' },
                  { key: 'world' as const, label: 'World', color: '#22C55E' },
                  { key: 'system' as const, label: 'System', color: '#3B82F6' },
                  { key: 'swing' as const, label: 'Swing', color: '#facc15' },
                ]).map((row) => {
                  const s = scorecard[row.key];
                  const grade = scorecard.grades[row.key];
                  return (
                    <React.Fragment key={row.key}>
                      <div className="bg-bg-base p-2 flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: row.color }} />
                        <span className="text-[10px] font-medium" style={{ color: row.color }}>{row.label}</span>
                      </div>
                      <div className="bg-bg-base p-2 text-center">
                        <span className="text-[12px] font-mono text-text-primary font-semibold">{s.avg.toFixed(2)}</span>
                      </div>
                      <div className="bg-bg-base p-2 text-center">
                        <span className="text-[12px] font-mono text-text-dim">{s.std.toFixed(2)}</span>
                      </div>
                      <div className="bg-bg-base p-2 text-center">
                        <span className="text-[12px] font-mono text-text-secondary">{s.max.toFixed(2)}</span>
                      </div>
                      <div className="bg-bg-base p-2 text-center">
                        <span className="text-[12px] font-mono text-text-secondary">{s.total.toFixed(1)}</span>
                      </div>
                      <div className="bg-bg-base p-2 text-center">
                        <span className={`text-[12px] font-mono font-semibold ${
                          grade >= 22 ? 'text-green-400' :
                          grade >= 20 ? 'text-lime-400' :
                          grade >= 17 ? 'text-yellow-400' :
                          grade >= 15 ? 'text-orange-400' : 'text-red-400'
                        }`}>{grade}<span className="text-[9px] text-text-dim font-normal">/25</span></span>
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>

              {/* Shape + Archetype + Scale + Density */}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="px-2 py-2 border border-white/5 rounded flex flex-col gap-1">
                  <span className="text-[9px] uppercase tracking-widest text-text-dim">Shape</span>
                  <div className="flex items-center gap-2">
                    <svg width="36" height="18" viewBox="0 0 36 18" className="shrink-0">
                      <polyline
                        points={scorecard.shape.curve
                          .map(([x, y]) => `${x * 36},${(1 - y) * 18}`)
                          .join(' ')}
                        fill="none"
                        stroke="#F59E0B"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="text-[11px] font-medium text-amber-400">{scorecard.shape.name}</span>
                  </div>
                  <span className="text-[9px] text-text-dim leading-snug">{scorecard.shape.description}</span>
                </div>
                <div className="px-2 py-2 border border-white/5 rounded flex flex-col gap-1">
                  <span className="text-[9px] uppercase tracking-widest text-text-dim">Archetype</span>
                  <div className="flex items-center gap-2">
                    <ArchetypeIcon archetypeKey={scorecard.archetype.key} size={18} />
                    <span className="text-[11px] font-medium text-violet-400">{scorecard.archetype.name}</span>
                    {scorecard.archetype.dominant.length > 0 && (
                      <span className="flex items-center gap-0.5">
                        {scorecard.archetype.dominant.map((f) => (
                          <span key={f} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: f === 'drive' ? 'var(--color-drive)' : f === 'world' ? 'var(--color-world)' : 'var(--color-system)' }} title={f} />
                        ))}
                      </span>
                    )}
                  </div>
                  <span className="text-[9px] text-text-dim leading-snug">{scorecard.archetype.description}</span>
                </div>
                <div className="px-2 py-2 border border-white/5 rounded flex flex-col gap-1">
                  <span className="text-[9px] uppercase tracking-widest text-text-dim">Scale</span>
                  <div className="flex items-center gap-2">
                    {/* Scale icon: stacked bars — more bars = larger scale */}
                    <svg width="18" height="18" viewBox="0 0 18 18" className="shrink-0">
                      {[0, 1, 2, 3, 4].map((i) => {
                        const scaleIdx = ['short', 'story', 'novel', 'epic', 'serial'].indexOf(scorecard.scale.key);
                        const active = i <= scaleIdx;
                        return <rect key={i} x={2 + i * 3} y={14 - (i + 1) * 2.4} width={2} height={(i + 1) * 2.4} rx={0.5} fill={active ? '#22D3EE' : '#ffffff10'} />;
                      })}
                    </svg>
                    <span className="text-[11px] font-medium text-cyan-400">{scorecard.scale.name}</span>
                    <span className="text-[9px] text-text-dim font-mono">{scorecard.scenes}s / {scorecard.arcs}a</span>
                  </div>
                  <span className="text-[9px] text-text-dim leading-snug">{scorecard.scale.description}</span>
                </div>
                <div className="px-2 py-2 border border-white/5 rounded flex flex-col gap-1">
                  <span className="text-[9px] uppercase tracking-widest text-text-dim">World Density</span>
                  <div className="flex items-center gap-2">
                    {/* Density icon: concentric circles — more rings = denser */}
                    <svg width="18" height="18" viewBox="0 0 18 18" className="shrink-0">
                      {[0, 1, 2, 3, 4].map((i) => {
                        const densityIdx = ['sparse', 'focused', 'developed', 'rich', 'sprawling'].indexOf(scorecard.density.key);
                        const active = i <= densityIdx;
                        const r = 2 + i * 1.8;
                        return <circle key={i} cx={9} cy={9} r={r} fill="none" stroke={active ? '#34D399' : '#ffffff10'} strokeWidth={1} />;
                      })}
                    </svg>
                    <span className="text-[11px] font-medium text-emerald-400">{scorecard.density.name}</span>
                    <span className="text-[9px] text-text-dim font-mono">{scorecard.density.density}/scene</span>
                  </div>
                  <span className="text-[9px] text-text-dim leading-snug">{scorecard.density.description}</span>
                </div>
              </div>

              {/* Per-arc score graph / delivery graph */}
              {scorecard.perArc.length > 1 && (() => {
                const arcs = scorecard.perArc;
                const dense = arcs.length >= 15;
                const W = 500;
                const H = dense ? 80 : 110;
                const PAD = { top: dense ? 8 : 16, right: 12, bottom: dense ? 8 : 28, left: 28 };
                const cw = W - PAD.left - PAD.right;
                const ch = H - PAD.top - PAD.bottom;

                const scoreColor = (v: number) => {
                  if (v >= 90) return '#22C55E';
                  if (v >= 80) { const p = (v - 80) / 10; return `rgb(${Math.round(163 - (163 - 34) * p)},${Math.round(230 + (197 - 230) * p)},${Math.round(53 + (94 - 53) * p)})`; }
                  if (v >= 70) { const p = (v - 70) / 10; return `rgb(${Math.round(250 - (250 - 163) * p)},${Math.round(204 + (230 - 204) * p)},${Math.round(21 + (53 - 21) * p)})`; }
                  if (v >= 60) { const p = (v - 60) / 10; return `rgb(${Math.round(249 + (250 - 249) * p)},${Math.round(115 + (204 - 115) * p)},${Math.round(22 - 22 * (1 - p))})`; }
                  const p = Math.max(0, v / 60);
                  return `rgb(${Math.round(239 + (249 - 239) * p)},${Math.round(68 + (115 - 68) * p)},${Math.round(68 * (1 - p))})`;
                };

                const arcPoints = arcs.map((a, i) => ({
                  x: PAD.left + i * (cw / (arcs.length - 1)),
                  y: PAD.top + ch - (a.grades.overall / 100) * ch,
                  score: a.grades.overall,
                }));

                const eng = scorecard.deliveryPoints;
                const engMaxAbs = Math.max(...eng.map((e) => Math.abs(e.smoothed)), 0.5) * 1.2;
                const engPoints = eng.map((e, i) => ({
                  x: PAD.left + i * (cw / Math.max(eng.length - 1, 1)),
                  y: PAD.top + ch / 2 - (e.smoothed / engMaxAbs) * (ch / 2),
                  delivery: e.delivery,
                  isPeak: e.isPeak,
                  isValley: e.isValley,
                }));
                const zeroY = PAD.top + ch / 2;

                return (
                  <div className="mt-4 pt-4 border-t border-white/8">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-[9px] uppercase tracking-widest text-text-dim">
                        {scorecardGraphView === 'arcs' ? 'Score by Arc' : 'Delivery'}
                      </h3>
                      <div className="flex items-center rounded border border-white/8 overflow-hidden">
                        {(['arcs', 'delivery'] as const).map((v) => (
                          <button
                            key={v}
                            onClick={() => setScorecardGraphView(v)}
                            className={`text-[9px] px-2 py-0.5 capitalize transition ${
                              scorecardGraphView === v
                                ? 'bg-white/10 text-text-primary'
                                : 'text-text-dim hover:text-text-secondary'
                            }`}
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                    </div>

                    {scorecardGraphView === 'arcs' ? (
                      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
                        <defs>
                          {arcPoints.slice(0, -1).map((p, i) => (
                            <linearGradient key={i} id={`sc-seg-${i}`} x1="0" y1="0" x2="1" y2="0">
                              <stop offset="0%" stopColor={scoreColor(p.score)} stopOpacity="0.3" />
                              <stop offset="100%" stopColor={scoreColor(arcPoints[i + 1].score)} stopOpacity="0.3" />
                            </linearGradient>
                          ))}
                          <linearGradient id="sc-line-grad" x1="0" y1="0" x2="1" y2="0">
                            {arcPoints.map((p, i) => (
                              <stop key={i} offset={`${(i / (arcPoints.length - 1)) * 100}%`} stopColor={scoreColor(p.score)} />
                            ))}
                          </linearGradient>
                        </defs>
                        {[0, 25, 50, 75, 100].map((v) => {
                          const y = PAD.top + ch - (v / 100) * ch;
                          return (
                            <g key={v}>
                              <line x1={PAD.left} y1={y} x2={PAD.left + cw} y2={y} stroke="white" strokeOpacity="0.05" />
                              <text x={PAD.left - 4} y={y + 3} textAnchor="end" fill="white" fillOpacity="0.2" fontSize="8" fontFamily="monospace">{v}</text>
                            </g>
                          );
                        })}
                        {arcPoints.slice(0, -1).map((p, i) => (
                          <path key={i} d={`M${p.x},${p.y} L${arcPoints[i+1].x},${arcPoints[i+1].y} L${arcPoints[i+1].x},${PAD.top+ch} L${p.x},${PAD.top+ch} Z`} fill={`url(#sc-seg-${i})`} />
                        ))}
                        <path d={arcPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')} fill="none" stroke="url(#sc-line-grad)" strokeWidth="2" strokeLinejoin="round" />
                        {arcPoints.map((p, i) => {
                          const isHovered = hoveredArcIdx === i;
                          return (
                            <g key={i} onMouseEnter={() => setHoveredArcIdx(i)} onMouseLeave={() => setHoveredArcIdx(null)} className="cursor-pointer">
                              <circle cx={p.x} cy={p.y} r={12} fill="transparent" />
                              {isHovered && (
                                <text x={p.x} y={p.y - 8} textAnchor="middle" fill={scoreColor(p.score)} fontSize="9" fontFamily="monospace" fontWeight="600">{p.score}</text>
                              )}
                            </g>
                          );
                        })}
                        {!dense && arcPoints.map((p, i) => (
                          <text key={i} x={p.x} y={H - 4} textAnchor="middle" fill="white" fillOpacity="0.3" fontSize="8" fontFamily="monospace">{i + 1}</text>
                        ))}
                      </svg>
                    ) : (
                      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
                        <line x1={PAD.left} y1={zeroY} x2={PAD.left + cw} y2={zeroY} stroke="white" strokeOpacity="0.12" />
                        <text x={PAD.left - 4} y={zeroY + 3} textAnchor="end" fill="white" fillOpacity="0.2" fontSize="8" fontFamily="monospace">0</text>
                        <path
                          d={`M${engPoints[0].x},${zeroY} ${engPoints.map((p) => `L${p.x},${Math.min(p.y, zeroY)}`).join(' ')} L${engPoints[engPoints.length-1].x},${zeroY} Z`}
                          fill="#F59E0B" fillOpacity="0.12"
                        />
                        <path
                          d={`M${engPoints[0].x},${zeroY} ${engPoints.map((p) => `L${p.x},${Math.max(p.y, zeroY)}`).join(' ')} L${engPoints[engPoints.length-1].x},${zeroY} Z`}
                          fill="#93C5FD" fillOpacity="0.08"
                        />
                        <polyline
                          points={engPoints.map((p) => `${p.x},${p.y}`).join(' ')}
                          fill="none" stroke="#F59E0B" strokeWidth="1.5" strokeLinejoin="round"
                        />
                        {engPoints.filter((p) => p.isPeak).map((p, i) => (
                          <polygon key={i} points={`${p.x},${p.y - 6} ${p.x - 4},${p.y - 1} ${p.x + 4},${p.y - 1}`} fill="#FCD34D" opacity="0.9" />
                        ))}
                        {engPoints.filter((p) => p.isValley).map((p, i) => (
                          <polygon key={i} points={`${p.x},${p.y + 6} ${p.x - 4},${p.y + 1} ${p.x + 4},${p.y + 1}`} fill="#93C5FD" opacity="0.8" />
                        ))}
                      </svg>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* Quick actions */}
        {hasNarrative && (
          <>
            <NowPlayingPill />

            {/* Export / Copy dropdown */}
            <div className="relative" ref={exportRef}>
              <button
                onClick={() => setExportOpen((v) => !v)}
                className={`px-2.5 py-1 rounded-full transition-colors flex items-center gap-1.5 text-[12px] border ${
                  exportOpen
                    ? 'text-text-primary bg-white/10 border-white/15'
                    : 'text-text-secondary hover:text-text-primary hover:bg-white/5 border-white/8 hover:border-white/15'
                }`}
                title="Copy & Export"
              >
                <IconDownload size={14} />
                <span>Export</span>
                <IconChevronDown size={10} className={`transition-transform ${exportOpen ? 'rotate-180' : ''}`} />
              </button>
              {exportOpen && (
                <div
                  className="absolute top-full right-0 mt-1 min-w-52 rounded-lg border border-white/10 py-1 z-50"
                  style={{ background: '#1a1a1a', boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)' }}
                >
                  <div className="px-3 pt-1.5 pb-1">
                    <span className="text-[9px] font-semibold text-text-dim uppercase tracking-widest">Copy to Clipboard</span>
                  </div>
                  <button onClick={() => copyAllText('prose')} disabled={!exportAvailability.hasProse} className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-[12px] transition-colors ${exportAvailability.hasProse ? 'text-text-secondary hover:text-text-primary hover:bg-white/5' : 'text-text-dim/50 cursor-not-allowed'}`}>
                    <svg className="w-3.5 h-3.5 text-text-dim shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                    Prose
                  </button>
                  <button onClick={() => copyAllText('plan')} disabled={!exportAvailability.hasPlans} className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-[12px] transition-colors ${exportAvailability.hasPlans ? 'text-text-secondary hover:text-text-primary hover:bg-white/5' : 'text-text-dim/50 cursor-not-allowed'}`}>
                    <svg className="w-3.5 h-3.5 text-text-dim shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                    Plans
                  </button>
                  <button onClick={() => copyAllText('summary')} disabled={!exportAvailability.hasSummaries} className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-[12px] transition-colors ${exportAvailability.hasSummaries ? 'text-text-secondary hover:text-text-primary hover:bg-white/5' : 'text-text-dim/50 cursor-not-allowed'}`}>
                    <svg className="w-3.5 h-3.5 text-text-dim shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                    Summaries
                  </button>
                  <button onClick={handleCopyCurrentEntryJson} className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[12px] transition-colors text-text-secondary hover:text-text-primary hover:bg-white/5">
                    <svg className="w-3.5 h-3.5 text-text-dim shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                    {state.inspectorContext?.type === 'scene' ? 'Scene' : 'World Commit'}
                  </button>
                  <button onClick={handleCopyFullJson} className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[12px] transition-colors text-text-secondary hover:text-text-primary hover:bg-white/5">
                    <svg className="w-3.5 h-3.5 text-text-dim shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                    Narrative
                  </button>
                  <button onClick={handleCopyBranchJson} disabled={!state.activeBranchId} className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-[12px] transition-colors ${state.activeBranchId ? 'text-text-secondary hover:text-text-primary hover:bg-white/5' : 'text-text-dim/50 cursor-not-allowed'}`}>
                    <svg className="w-3.5 h-3.5 text-text-dim shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                    Branch
                  </button>
                  <div className="my-1 border-t border-white/8" />
                  <div className="px-3 pt-1.5 pb-1">
                    <span className="text-[9px] font-semibold text-text-dim uppercase tracking-widest">Export</span>
                  </div>
                  <button onClick={() => { setReportOpen(true); setExportOpen(false); }} className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[12px] transition-colors text-text-secondary hover:text-text-primary hover:bg-white/5">
                    <svg className="w-3.5 h-3.5 text-text-dim shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                    Analysis Report
                  </button>
                  <button onClick={handleExportEpub} disabled={!exportAvailability.hasProse} className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-[12px] transition-colors ${exportAvailability.hasProse ? 'text-text-secondary hover:text-text-primary hover:bg-white/5' : 'text-text-dim/50 cursor-not-allowed'}`}>
                    <IconBook size={14} className="text-text-dim shrink-0" />
                    EPUB
                  </button>
                  <button onClick={handleExportAudio} disabled={!exportAvailability.hasAudio} className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-[12px] transition-colors ${exportAvailability.hasAudio ? 'text-text-secondary hover:text-text-primary hover:bg-white/5' : 'text-text-dim/50 cursor-not-allowed'}`}>
                    <svg className="w-3.5 h-3.5 text-text-dim shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                    Audio
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={() => setSlidesOpen(true)}
              className="px-2.5 py-1 rounded-full transition-colors flex items-center gap-1.5 text-[12px] border border-white/8 text-text-secondary hover:text-text-primary hover:bg-white/5 hover:border-white/15"
              title="View slides"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8" />
                <path d="M12 17v4" />
              </svg>
              <span>Slides</span>
            </button>
          </>
        )}

        {/* Copy toast */}
        {copyToast && (
          <div className="fixed top-14 right-4 z-[100] px-3 py-1.5 rounded-lg bg-green-500/20 border border-green-500/30 text-green-300 text-[11px] font-medium animate-in fade-in slide-in-from-top-1 duration-200">
            {copyToast}
          </div>
        )}
      </div>

      {/* Modals */}
      {apiKeysOpen && <ApiKeyModal access={access} onClose={() => setApiKeysOpen(false)} />}
      {logsOpen && <ApiLogsModal onClose={() => setLogsOpen(false)} />}
      {systemLogsOpen && <SystemLogModal onClose={() => setSystemLogsOpen(false)} />}

      {cubeExplorerOpen && narrative && (
        <CubeExplorer
          narrative={narrative}
          resolvedKeys={state.resolvedEntryKeys}
          currentSceneIndex={state.currentSceneIndex}
          onClose={() => setCubeExplorerOpen(false)}
          onNavigate={(idx) => dispatch({ type: 'SET_SCENE_INDEX', index: idx })}
        />
      )}
      {formulaOpen && <FormulaModal onClose={() => setFormulaOpen(false)} />}
      {definitionsOpen && <DefinitionsModal onClose={() => setDefinitionsOpen(false)} />}
      {propositionAnalysisOpen && narrative && (
        <PropositionAnalysisModal
          narrative={narrative}
          resolvedKeys={state.resolvedEntryKeys}
          onClose={() => setPropositionAnalysisOpen(false)}
        />
      )}
      {threadGraphOpen && narrative && (
        <ThreadGraphModal
          narrative={narrative}
          resolvedKeys={state.resolvedEntryKeys}
          currentSceneIndex={state.currentSceneIndex}
          onClose={() => setThreadGraphOpen(false)}
          onSelectThread={(id) => {
            dispatch({ type: 'SET_INSPECTOR', context: { type: 'thread', threadId: id } });
            setThreadGraphOpen(false);
          }}
        />
      )}
      {markovOpen && narrative && (
        <MarkovChainModal
          narrative={narrative}
          resolvedKeys={state.resolvedEntryKeys}
          currentSceneIndex={state.currentSceneIndex}
          onClose={() => setMarkovOpen(false)}
        />
      )}
      {beatProfileOpen && narrative && state.activeBranchId && (
        <BeatProfileModal
          narrative={narrative}
          resolvedKeys={state.resolvedEntryKeys}
          branchId={state.activeBranchId}
          onClose={() => setBeatProfileOpen(false)}
        />
      )}
      {branchContextOpen && narrative && (
        <BranchContextModal
          narrative={narrative}
          resolvedKeys={state.resolvedEntryKeys}
          currentSceneIndex={state.currentSceneIndex}
          onClose={() => setBranchContextOpen(false)}
        />
      )}
      {slidesOpen && narrative && (
        <SlidesPlayer
          narrative={narrative}
          resolvedKeys={state.resolvedEntryKeys}
          onClose={() => setSlidesOpen(false)}
        />
      )}
      {reportOpen && narrative && (
        <NarrativeReport
          narrative={narrative}
          resolvedKeys={state.resolvedEntryKeys}
          onClose={() => setReportOpen(false)}
        />
      )}
      {editingEntry && (
        <NarrativeEditModal entry={editingEntry} onClose={() => setEditingEntry(null)} />
      )}
      {exportPackageOpen && narrative && (
        <ExportPackageModal narrative={narrative} onClose={() => setExportPackageOpen(false)} />
      )}
      {importPackageOpen && (
        <ImportPackageModal onClose={() => setImportPackageOpen(false)} />
      )}
    </div>
  );
}
