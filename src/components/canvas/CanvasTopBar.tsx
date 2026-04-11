'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { resolveEntry, isScene, type Scene, type ProseVersion, type PlanVersion } from '@/types/narrative';
import type { GraphViewMode } from '@/types/narrative';
import { getResolvedProseVersion, getResolvedPlanVersion, resolveProseForBranch, resolvePlanForBranch } from '@/lib/narrative-utils';
import { VersionHistoryTree } from './VersionHistoryTree';
import { RegenerateEmbeddingsModal } from '@/components/topbar/RegenerateEmbeddingsModal';
import { IconGlobe, IconLightbulb, IconThread, IconNetwork, IconNotepad, IconDocument, IconWaveform, IconSearch } from '@/components/icons';

const GRAPH_DOMAINS = [
  {
    label: 'World',
    local: 'spatial' as GraphViewMode,
    global: 'overview' as GraphViewMode,
    Icon: IconGlobe,
    description: 'Characters & locations',
  },
  {
    label: 'System',
    local: 'spark' as GraphViewMode,
    global: 'codex' as GraphViewMode,
    Icon: IconLightbulb,
    description: 'World knowledge & systems',
  },
  {
    label: 'Threads',
    local: 'pulse' as GraphViewMode,
    global: 'threads' as GraphViewMode,
    Icon: IconThread,
    description: 'Narrative threads & tensions',
  },
];

const SCOPE_PAIRS: Record<string, { local: GraphViewMode; global: GraphViewMode }> = {
  spatial:  { local: 'spatial', global: 'overview' },
  overview: { local: 'spatial', global: 'overview' },
  spark:    { local: 'spark',   global: 'codex'    },
  codex:    { local: 'spark',   global: 'codex'    },
  pulse:    { local: 'pulse',   global: 'threads'  },
  threads:  { local: 'pulse',   global: 'threads'  },
};

const GRAPH_MODES = new Set<GraphViewMode>(['spatial', 'overview', 'spark', 'codex', 'pulse', 'threads']);

type CanvasMode = 'graph' | 'plan' | 'prose' | 'audio' | 'search';

// Module-level state shared with SceneProseView
let beatPlanLinkedModeGlobal = false;

function BeatPlanToggle() {
  const [isOn, setIsOn] = useState(() => beatPlanLinkedModeGlobal);

  // Listen for toggle events from SceneProseView to stay in sync
  useEffect(() => {
    const handleToggled = (e: Event) => {
      const newValue = (e as CustomEvent).detail?.value ?? !isOn;
      setIsOn(newValue);
      beatPlanLinkedModeGlobal = newValue;
    };
    window.addEventListener('canvas:beat-plan-toggled', handleToggled);
    return () => window.removeEventListener('canvas:beat-plan-toggled', handleToggled);
  }, [isOn]);

  const handleClick = () => {
    const newValue = !isOn;
    setIsOn(newValue);
    beatPlanLinkedModeGlobal = newValue;
    window.dispatchEvent(new CustomEvent('canvas:toggle-beat-plan'));
    window.dispatchEvent(new CustomEvent('canvas:beat-plan-toggled', { detail: { value: newValue } }));
  };

  return (
    <button
      onClick={handleClick}
      className="relative inline-flex items-center rounded-full transition-all duration-200 overflow-hidden"
      style={{
        width: '64px',
        height: '20px',
        backgroundColor: isOn ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255, 255, 255, 0.05)',
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: isOn ? 'rgba(245, 158, 11, 0.5)' : 'rgba(255, 255, 255, 0.1)',
      }}
    >
      {/* Background track with labels */}
      <div className="absolute inset-0 flex items-center justify-between px-1.5">
        <span
          className="text-[8px] font-semibold transition-opacity duration-200"
          style={{
            opacity: isOn ? 0 : 0.4,
            color: 'rgba(255, 255, 255, 0.4)',
          }}
        >
          OFF
        </span>
        <span
          className="text-[8px] font-semibold transition-opacity duration-200"
          style={{
            opacity: isOn ? 0.9 : 0,
            color: 'rgb(251, 191, 36)',
          }}
        >
          ON
        </span>
      </div>
      {/* Sliding pill */}
      <div
        className="absolute top-0.5 bottom-0.5 rounded-full transition-all duration-200"
        style={{
          width: '30px',
          left: isOn ? 'calc(100% - 31px)' : '1px',
          backgroundColor: isOn ? 'rgb(251, 191, 36)' : 'rgba(255, 255, 255, 0.3)',
          boxShadow: isOn ? '0 0 10px rgba(251, 191, 36, 0.5)' : '0 1px 3px rgba(0, 0, 0, 0.3)',
        }}
      />
    </button>
  );
}

const VERSION_TYPE_COLORS = {
  generate: 'text-emerald-400',
  rewrite: 'text-sky-400',
  edit: 'text-amber-400',
};

const VERSION_TYPE_BG_COLORS = {
  generate: 'bg-emerald-400',
  rewrite: 'bg-sky-400',
  edit: 'bg-amber-400',
};

function VersionSelector({
  versions,
  currentVersion,
  pinnedVersion,
  type,
  onSelectVersion,
  onPinVersion,
  planVersions,
}: {
  versions: ProseVersion[] | PlanVersion[];
  currentVersion: string | undefined;
  pinnedVersion: string | undefined;
  type: 'prose' | 'plan';
  onSelectVersion: (version: string) => void;
  onPinVersion: (version: string | undefined) => void;
  planVersions?: PlanVersion[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  if (versions.length === 0) {
    return (
      <span className="text-[9px] text-text-dim/40 font-mono">
        V0
      </span>
    );
  }

  // Find the version object for current version
  const currentVersionObj = versions.find(v => v.version === currentVersion);
  const versionType = currentVersionObj?.versionType ?? 'generate';

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono transition-all hover:bg-white/10 ${
          pinnedVersion ? 'ring-1 ring-inset ring-amber-400/40' : ''
        }`}
      >
        <div className="flex items-center gap-1">
          <span className={`w-1 h-1 rounded-full ${VERSION_TYPE_BG_COLORS[versionType]}`} />
          <span className="text-text-primary font-medium">
            V{currentVersion ?? '0'}
          </span>
        </div>
        {pinnedVersion && (
          <div className="w-1 h-1 rounded-full bg-amber-400" />
        )}
        <svg
          className={`w-2.5 h-2.5 text-text-dim/40 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          viewBox="0 0 8 8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M1 2.5 L4 5.5 L7 2.5" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1.5 z-[100] bg-bg-secondary/95 backdrop-blur-sm border border-border rounded-lg shadow-xl min-w-[240px] max-h-[320px] overflow-hidden">
          <VersionHistoryTree
            versions={versions}
            currentVersion={currentVersion}
            pinnedVersion={pinnedVersion}
            onSelectVersion={(v) => {
              onSelectVersion(v);
              setIsOpen(false);
            }}
            onPinVersion={onPinVersion}
            type={type}
            planVersions={planVersions}
          />
        </div>
      )}
    </div>
  );
}

function resolveCanvasMode(graphViewMode: GraphViewMode): CanvasMode {
  if (graphViewMode === 'plan') return 'plan';
  if (graphViewMode === 'prose') return 'prose';
  if (graphViewMode === 'audio') return 'audio';
  if (graphViewMode === 'search') return 'search';
  return 'graph';
}

export function CanvasTopBar() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const graphViewMode = state.graphViewMode;
  const canvasMode = resolveCanvasMode(graphViewMode);

  const isGraphMode = GRAPH_MODES.has(graphViewMode);
  const scopePair = isGraphMode ? SCOPE_PAIRS[graphViewMode] : null;
  const isLocal = scopePair ? graphViewMode === scopePair.local : false;

  // Remember last graph mode so we can return to it
  const lastGraphModeRef = useRef<GraphViewMode>('spatial');
  useEffect(() => {
    if (GRAPH_MODES.has(graphViewMode)) lastGraphModeRef.current = graphViewMode;
  }, [graphViewMode]);

  // ── Current scene ──────────────────────────────────────────────────────
  const currentScene = useMemo<Scene | null>(() => {
    if (!narrative) return null;
    const key = state.resolvedEntryKeys[state.currentSceneIndex];
    if (!key) return null;
    const entry = resolveEntry(narrative, key);
    return entry && isScene(entry) ? entry : null;
  }, [narrative, state.resolvedEntryKeys, state.currentSceneIndex]);

  // ── Version state ────────────────────────────────────────────────────
  const branches = narrative?.branches ?? {};
  const branchId = state.activeBranchId;

  const currentProseVersion = useMemo(() => {
    if (!currentScene || !branchId) return undefined;
    return getResolvedProseVersion(currentScene, branchId, branches);
  }, [currentScene, branchId, branches]);

  const currentPlanVersion = useMemo(() => {
    if (!currentScene || !branchId) return undefined;
    return getResolvedPlanVersion(currentScene, branchId, branches);
  }, [currentScene, branchId, branches]);

  const pinnedProseVersion = useMemo(() => {
    if (!currentScene || !branchId) return undefined;
    return branches[branchId]?.versionPointers?.[currentScene.id]?.proseVersion;
  }, [currentScene, branchId, branches]);

  const pinnedPlanVersion = useMemo(() => {
    if (!currentScene || !branchId) return undefined;
    return branches[branchId]?.versionPointers?.[currentScene.id]?.planVersion;
  }, [currentScene, branchId, branches]);

  const handleSelectProseVersion = useCallback((version: string) => {
    if (!currentScene || !branchId) return;
    dispatch({
      type: 'SET_VERSION_POINTER',
      branchId,
      sceneId: currentScene.id,
      pointerType: 'prose',
      version,
    });
  }, [dispatch, currentScene, branchId]);

  const handlePinProseVersion = useCallback((version: string | undefined) => {
    if (!currentScene || !branchId) return;
    dispatch({
      type: 'SET_VERSION_POINTER',
      branchId,
      sceneId: currentScene.id,
      pointerType: 'prose',
      version,
    });
  }, [dispatch, currentScene, branchId]);

  const handleSelectPlanVersion = useCallback((version: string) => {
    if (!currentScene || !branchId) return;
    dispatch({
      type: 'SET_VERSION_POINTER',
      branchId,
      sceneId: currentScene.id,
      pointerType: 'plan',
      version,
    });
  }, [dispatch, currentScene, branchId]);

  const handlePinPlanVersion = useCallback((version: string | undefined) => {
    if (!currentScene || !branchId) return;
    dispatch({
      type: 'SET_VERSION_POINTER',
      branchId,
      sceneId: currentScene.id,
      pointerType: 'plan',
      version,
    });
  }, [dispatch, currentScene, branchId]);

  // ── Mode-specific stats ───────────────────────────────────────────────
  const planStats = useMemo(() => {
    if (!currentScene || !branchId) return null;
    const plan = resolvePlanForBranch(currentScene, branchId, branches);
    if (!plan?.beats) return null;
    const beats = plan.beats.length;
    const propositions =
      plan.beats.reduce(
        (sum, b) => sum + (b.propositions?.length ?? 0),
        0,
      );
    return { beats, propositions };
  }, [currentScene, branchId, branches]);

  const proseStats = useMemo(() => {
    if (!currentScene || !branchId) return null;
    const resolved = resolveProseForBranch(currentScene, branchId, branches);
    if (!resolved.prose) return null;
    const text = resolved.prose;
    const words = text.split(/\s+/).filter(Boolean).length;
    const paragraphs = text.split(/\n\n+/).filter((p) => p.trim()).length;
    return { words, paragraphs };
  }, [currentScene, branchId, branches]);

  // Check if beat plan toggle should show
  const showBeatPlanToggle = useMemo(() => {
    if (!currentScene || !branchId) return false;
    const plan = resolvePlanForBranch(currentScene, branchId, branches);
    const prose = resolveProseForBranch(currentScene, branchId, branches);
    return !!(plan && prose.beatProseMap && prose.beatProseMap.chunks.length === plan.beats.length);
  }, [currentScene, branchId, branches]);

  // ── ARC navigation ────────────────────────────────────────────────────
  const arcNav = useMemo(() => {
    if (!narrative) return { total: 0, currentArc: 0, arcOrder: [] as { arcId: string; firstTlIdx: number }[] };
    const arcs = Object.values(narrative.arcs);
    const arcOrder: { arcId: string; firstTlIdx: number }[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < state.resolvedEntryKeys.length; i++) {
      const entry = resolveEntry(narrative, state.resolvedEntryKeys[i]);
      if (entry && isScene(entry)) {
        const arc = arcs.find((a) => a.sceneIds.includes(entry.id));
        if (arc && !seen.has(arc.id)) {
          seen.add(arc.id);
          arcOrder.push({ arcId: arc.id, firstTlIdx: i });
        }
      }
    }
    let currentArc = 0;
    for (let i = arcOrder.length - 1; i >= 0; i--) {
      if (state.currentSceneIndex >= arcOrder[i].firstTlIdx) { currentArc = i + 1; break; }
    }
    return { total: arcOrder.length, currentArc, arcOrder };
  }, [narrative, state.resolvedEntryKeys, state.currentSceneIndex]);

  // ── Scene navigation ──────────────────────────────────────────────────
  const sceneNav = useMemo(() => {
    if (!narrative) return { sceneIndices: [] as number[], total: 0, currentSceneNum: 0 };
    const sceneIndices: number[] = [];
    for (let i = 0; i < state.resolvedEntryKeys.length; i++) {
      if (narrative.scenes[state.resolvedEntryKeys[i]]) sceneIndices.push(i);
    }
    let currentSceneNum = 0;
    for (let i = 0; i < sceneIndices.length; i++) {
      if (sceneIndices[i] <= state.currentSceneIndex) currentSceneNum = i + 1;
    }
    return { sceneIndices, total: sceneIndices.length, currentSceneNum };
  }, [narrative, state.resolvedEntryKeys, state.currentSceneIndex]);

  // ── Inline editing ────────────────────────────────────────────────────
  const [editField, setEditField] = useState<'scene' | 'arc' | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Regenerate Embeddings modal ────────────────────────────────────────
  const [showEmbeddingsModal, setShowEmbeddingsModal] = useState(false);

  useEffect(() => {
    if (editField) setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 30);
    else setEditValue('');
  }, [editField]);

  const commit = useCallback(() => {
    const n = parseInt(editValue, 10);
    if (!isNaN(n) && n >= 1) {
      if (editField === 'scene') {
        const idx = Math.min(n - 1, sceneNav.sceneIndices.length - 1);
        if (sceneNav.sceneIndices[idx] !== undefined) {
          dispatch({ type: 'SET_SCENE_INDEX', index: sceneNav.sceneIndices[idx] });
        }
      } else if (editField === 'arc') {
        const idx = Math.min(n - 1, arcNav.arcOrder.length - 1);
        if (arcNav.arcOrder[idx]) {
          dispatch({ type: 'SET_SCENE_INDEX', index: arcNav.arcOrder[idx].firstTlIdx });
        }
      }
    }
    setEditField(null);
  }, [editValue, editField, sceneNav, arcNav, dispatch]);

  const switchMode = useCallback((mode: CanvasMode) => {
    if (mode === 'graph') dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode: lastGraphModeRef.current });
    else dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode });
  }, [dispatch]);

  const inputClass = "w-8 bg-white/5 text-center text-[10px] font-mono text-text-primary rounded px-1 py-0.5 outline-none border border-white/15 focus:border-white/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  return (
    <div className="h-9 shrink-0 flex items-center px-2 gap-2 glass-panel border-b border-border">

      {/* Left — ARC / SCENE navigation */}
      {narrative && sceneNav.total > 0 ? (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <span className="text-[9px] uppercase tracking-wider text-text-dim/60">Arc</span>
            {editField === 'arc' ? (
              <input ref={inputRef} type="number" min={1} max={arcNav.total} value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditField(null); }}
                onBlur={commit} className={inputClass} />
            ) : (
              <button type="button"
                onClick={() => { setEditField('arc'); setEditValue(String(arcNav.currentArc)); }}
                className="text-[10px] font-mono text-text-secondary hover:text-text-primary transition-colors tabular-nums">
                {arcNav.currentArc}<span className="text-text-dim/40">/{arcNav.total}</span>
              </button>
            )}
          </div>

          <div className="w-px h-3 bg-border" />

          <div className="flex items-center gap-1">
            <span className="text-[9px] uppercase tracking-wider text-text-dim/60">Scene</span>
            {editField === 'scene' ? (
              <input ref={inputRef} type="number" min={1} max={sceneNav.total} value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditField(null); }}
                onBlur={commit} className={inputClass} />
            ) : (
              <button type="button"
                onClick={() => { setEditField('scene'); setEditValue(String(sceneNav.currentSceneNum)); }}
                className="text-[10px] font-mono text-text-secondary hover:text-text-primary transition-colors tabular-nums">
                {sceneNav.currentSceneNum}<span className="text-text-dim/40">/{sceneNav.total}</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <span className="text-[10px] text-text-dim/40">No scenes</span>
      )}

      {/* Contextual controls per mode */}
      {canvasMode === 'plan' && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-sky-400/60">Plan</span>
          {currentScene && (currentScene.planVersions?.length ?? 0) > 0 && (
            <VersionSelector
              versions={currentScene.planVersions ?? []}
              currentVersion={currentPlanVersion}
              pinnedVersion={pinnedPlanVersion}
              type="plan"
              onSelectVersion={handleSelectPlanVersion}
              onPinVersion={handlePinPlanVersion}
            />
          )}
          {planStats && (
            <span className="text-[9px] text-text-dim/50 font-mono tabular-nums">
              {planStats.beats} beats{planStats.propositions > 0 && <> &middot; {planStats.propositions} props</>}
            </span>
          )}
          {!planStats && <span className="text-[9px] text-text-dim/30">No plan</span>}

          {/* Regenerate Embeddings button (plan mode only) */}
          {narrative && (
            <>
              <div className="w-px h-3 bg-border ml-1" />
              <button
                onClick={() => setShowEmbeddingsModal(true)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] text-text-dim/60 hover:text-text-dim transition-colors"
                title="Regenerate Embeddings"
              >
                <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                </svg>
                <span>Refresh</span>
              </button>
            </>
          )}
        </div>
      )}

      {canvasMode === 'audio' && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-violet-400/60">Audio</span>
          {currentScene?.audioUrl
            ? <span className="text-[9px] text-text-dim/50">Ready</span>
            : proseStats
              ? <span className="text-[9px] text-text-dim/30">Not generated</span>
              : <span className="text-[9px] text-text-dim/30">No prose</span>}
        </div>
      )}

      {canvasMode === 'prose' && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-emerald-400/60">Prose</span>
          {currentScene && (currentScene.proseVersions?.length ?? 0) > 0 && (
            <VersionSelector
              versions={currentScene.proseVersions ?? []}
              currentVersion={currentProseVersion}
              pinnedVersion={pinnedProseVersion}
              type="prose"
              onSelectVersion={handleSelectProseVersion}
              onPinVersion={handlePinProseVersion}
              planVersions={currentScene.planVersions}
            />
          )}
          {proseStats && (
            <span className="text-[9px] text-text-dim/50 font-mono tabular-nums">
              {proseStats.words.toLocaleString()} words &middot; {proseStats.paragraphs} paragraphs
            </span>
          )}
          {!proseStats && planStats && <span className="text-[9px] text-text-dim/30">Not written</span>}
          {!proseStats && !planStats && <span className="text-[9px] text-text-dim/30">No plan</span>}

          {/* Beat plan toggle (only when beat mapping exists) */}
          {showBeatPlanToggle && (
            <>
              <div className="w-px h-3 bg-border ml-1" />
              <BeatPlanToggle />
            </>
          )}
        </div>
      )}

      {canvasMode === 'search' && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-amber-400/60">Search</span>

          {/* Clear Search button */}
          <div className="w-px h-3 bg-border" />
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('search:clear'))}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] text-text-dim/60 hover:text-text-dim transition-colors"
            title="Clear Search"
          >
            <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
            <span>Clear</span>
          </button>

          {/* Regenerate Embeddings button */}
          {narrative && (
            <>
              <div className="w-px h-3 bg-border" />
              <button
                onClick={() => setShowEmbeddingsModal(true)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] text-text-dim/60 hover:text-text-dim transition-colors"
                title="Regenerate Embeddings"
              >
                <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                </svg>
                <span>Generate Embeddings</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right — Mode toggles */}
      <div className="flex items-center gap-2">
        {/* Graph sub-controls: scope + domain */}
        {canvasMode === 'graph' && scopePair && (
          <>
            {/* Scope toggle */}
            <div className="flex items-center rounded-md overflow-hidden border border-white/10">
              <button
                className={`px-2 py-1 text-[10px] font-medium transition-colors ${
                  isLocal
                    ? 'bg-white/10 text-text-primary'
                    : 'text-text-dim/60 hover:text-text-secondary hover:bg-white/5'
                }`}
                onClick={() => dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode: scopePair.local })}
              >
                Scene
              </button>
              <div className="w-px h-4 bg-white/10" />
              <button
                className={`px-2 py-1 text-[10px] font-medium transition-colors ${
                  !isLocal
                    ? 'bg-white/10 text-text-primary'
                    : 'text-text-dim/60 hover:text-text-secondary hover:bg-white/5'
                }`}
                onClick={() => dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode: scopePair.global })}
              >
                Full
              </button>
            </div>

            {/* Domain tabs */}
            <div className="flex items-center rounded-md overflow-hidden border border-white/10">
              {GRAPH_DOMAINS.map(({ label, local, global: globalMode, Icon }, idx) => {
                const isActive = graphViewMode === local || graphViewMode === globalMode;
                return (
                  <div key={label} className="flex items-center">
                    {idx > 0 && <div className="w-px h-4 bg-white/10" />}
                    <button
                      className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors ${
                        isActive
                          ? 'bg-white/10 text-text-primary'
                          : 'text-text-dim/60 hover:text-text-secondary hover:bg-white/5'
                      }`}
                      onClick={() => dispatch({
                        type: 'SET_GRAPH_VIEW_MODE',
                        mode: isLocal ? local : globalMode,
                      })}
                    >
                      <Icon size={12} />
                      {label}
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Main canvas mode selector */}
        <div className="flex items-center rounded-md overflow-hidden border border-white/10">
          {[
            { mode: 'graph' as CanvasMode, Icon: IconNetwork, label: 'Graph', sceneOnly: false },
            { mode: 'plan' as CanvasMode, Icon: IconNotepad, label: 'Plan', sceneOnly: true },
            { mode: 'prose' as CanvasMode, Icon: IconDocument, label: 'Prose', sceneOnly: true },
            { mode: 'audio' as CanvasMode, Icon: IconWaveform, label: 'Audio', sceneOnly: true },
            { mode: 'search' as CanvasMode, Icon: IconSearch, label: 'Search', sceneOnly: false },
          ]
            .filter(({ sceneOnly }) => !sceneOnly || currentScene)
            .map(({ mode, Icon, label }, idx) => {
              const isActive = canvasMode === mode;
              return (
                <div key={mode} className="flex items-center">
                  {idx > 0 && <div className="w-px h-4 bg-white/10" />}
                  <button
                    className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors ${
                      isActive
                        ? 'bg-white/10 text-text-primary'
                        : 'text-text-dim/60 hover:text-text-secondary hover:bg-white/5'
                    }`}
                    onClick={() => switchMode(mode)}
                  >
                    <Icon size={12} />
                    {label}
                  </button>
                </div>
              );
            })}
        </div>
      </div>

      {/* Regenerate Embeddings Modal */}
      {showEmbeddingsModal && (
        <RegenerateEmbeddingsModal onClose={() => setShowEmbeddingsModal(false)} />
      )}
    </div>
  );
}
