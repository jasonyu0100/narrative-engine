'use client';

import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { useStore } from '@/lib/store';
import { resolveEntry, isScene, NARRATIVE_CUBE, type CubeCorner, type CubeCornerKey, type ForceSnapshot, type Scene } from '@/types/narrative';
import { detectCubeCorner, computeForceSnapshots, computeWindowedForces, computeDeliveryCurve, classifyCurrentPosition, FORCE_WINDOW_SIZE } from '@/lib/narrative-utils';

// ── 3D math helpers ──────────────────────────────────────────────────────────

type Vec3 = [number, number, number];

function rotateY(p: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
}

function rotateX(p: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
}

function project(p: Vec3, w: number, h: number, fov: number): [number, number] {
  const d = fov / (fov + p[2]);
  return [w / 2 + p[0] * d, h / 2 - p[1] * d];
}

// Map z-score force values to cube coordinates via tanh compression.
// z≈0 (average) stays centered; extreme values asymptote to ±1 corners.
// Drive → Y (vertical), World → X (horizontal), System → Z (depth)
function forcesToCubePos(drive: number, world: number, system: number): Vec3 {
  return [Math.tanh(world), Math.tanh(drive), Math.tanh(system)];
}

// ── Cube corner positions ────────────────────────────────────────────────────

const CUBE_EDGES: [number, number][] = [
  [0, 1], [1, 3], [3, 2], [2, 0], // front face
  [4, 5], [5, 7], [7, 6], [6, 4], // back face
  [0, 4], [1, 5], [2, 6], [3, 7], // connecting edges
];

const CORNER_KEYS: CubeCornerKey[] = ['LLL', 'HLL', 'LHL', 'HHL', 'LLH', 'HLH', 'LHH', 'HHH'];
const CORNER_POSITIONS: Vec3[] = CORNER_KEYS.map((k) => {
  const c = NARRATIVE_CUBE[k].forces;
  return forcesToCubePos(c.drive, c.world, c.system);
});

// ── Force data type for AI analysis ──────────────────────────────────────────

type SceneForceEntry = {
  sceneId: string;
  arcId: string;
  arcName: string;
  corner: CubeCorner;
  cornerKey: CubeCornerKey;
  forces: { drive: number; world: number; system: number };
  swing: number;
};

// ── Component ────────────────────────────────────────────────────────────────

export function NarrativeCubeViewer({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { state } = useStore();
  const narrative = state.activeNarrative;
  const resolvedKeys = state.resolvedEntryKeys;

  // Rotation state
  const [rotY, setRotY] = useState(-0.6);
  const [rotX, setRotX] = useState(0.4);
  const dragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Scene stepping state — index into forceEntries (scenes only).
  // Initialized to the scene matching the current timeline position.
  const [focusedIdx, setFocusedIdx] = useState<number>(0);

  // Force mode: global (full-history z-score) vs local (rolling window)
  const [forceMode, setForceMode] = useState<'global' | 'local'>('global');

  // Playback state
  const [playing, setPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(10000);
  const [countdown, setCountdown] = useState(0);

  // AI analysis state

  // Shared scene list derived from resolved keys
  const allScenes = useMemo(() => {
    if (!narrative) return [];
    return resolvedKeys
      .map((k) => resolveEntry(narrative, k))
      .filter((e): e is Scene => !!e && isScene(e));
  }, [narrative, resolvedKeys]);

  // Force map: global = full-history z-score, local = per-scene rolling window
  const forceMap = useMemo(() => {
    if (allScenes.length === 0) return {};
    if (forceMode === 'global') return computeForceSnapshots(allScenes);
    // Local: compute windowed forces for each scene and merge
    const merged: Record<string, ForceSnapshot> = {};
    for (let i = 0; i < allScenes.length; i++) {
      const w = computeWindowedForces(allScenes, i);
      const scene = allScenes[i];
      if (w.forceMap[scene.id]) merged[scene.id] = w.forceMap[scene.id];
    }
    return merged;
  }, [allScenes, forceMode]);

  // Build force trajectory from all scenes
  const trajectory = useMemo(() => {
    if (!narrative) return [];
    const pts: { pos: Vec3; index: number }[] = [];
    let lastForce = { drive: 0, world: 0, system: 0 };
    for (let i = 0; i < resolvedKeys.length; i++) {
      const entry = resolveEntry(narrative, resolvedKeys[i]);
      if (entry && isScene(entry)) {
        lastForce = forceMap[entry.id] ?? lastForce;
      }
      pts.push({
        pos: forcesToCubePos(lastForce.drive, lastForce.world, lastForce.system),
        index: i,
      });
    }
    return pts;
  }, [narrative, resolvedKeys, forceMap]);

  // Build per-scene force entries for stepping and AI analysis
  const forceEntries = useMemo((): SceneForceEntry[] => {
    if (!narrative) return [];
    const entries: SceneForceEntry[] = [];
    let prevForce: ForceSnapshot | null = null;
    for (let i = 0; i < resolvedKeys.length; i++) {
      const entry = resolveEntry(narrative, resolvedKeys[i]);
      if (entry && isScene(entry)) {
        const f = forceMap[entry.id];
        if (f) {
          const arc = narrative.arcs[entry.arcId];
          const corner = detectCubeCorner(f);
          let swing = 0;
          if (prevForce) {
            const dp = f.drive - prevForce.drive;
            const dc = f.world - prevForce.world;
            const dk = f.system - prevForce.system;
            swing = Math.sqrt(dp * dp + dc * dc + dk * dk);
          }
          entries.push({
            sceneId: entry.id,
            arcId: entry.arcId,
            arcName: arc?.name ?? entry.arcId,
            corner,
            cornerKey: corner.key,
            forces: f,
            swing,
          });
          prevForce = f;
        }
      }
    }
    return entries;
  }, [narrative, resolvedKeys, forceMap]);

  // Current corner derived from the focused scene's forces
  const currentCorner = useMemo(() => {
    const entry = forceEntries[focusedIdx];
    if (!entry) return null;
    return entry.corner;
  }, [forceEntries, focusedIdx]);

  // Local delivery position from the trailing window ending at focusedIdx
  const localPosition = useMemo(() => {
    if (forceEntries.length === 0) return null;
    const windowEntries = forceEntries.slice(Math.max(0, focusedIdx - FORCE_WINDOW_SIZE + 1), focusedIdx + 1);
    const snapshots = windowEntries.map((e) => e.forces);
    const pts = computeDeliveryCurve(snapshots);
    return pts.length > 0 ? classifyCurrentPosition(pts) : null;
  }, [forceEntries, focusedIdx]);

  // Initialize focused index to the current timeline scene
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current || forceEntries.length === 0 || !narrative) return;
    initializedRef.current = true;
    // Find which forceEntry index corresponds to the current scene
    const currentKey = resolvedKeys[state.currentSceneIndex];
    const idx = forceEntries.findIndex((e) => e.sceneId === currentKey);
    if (idx >= 0) setFocusedIdx(idx);
  }, [forceEntries, narrative, resolvedKeys, state.currentSceneIndex]);

  // Scroll sidebar to keep focused scene visible
  useEffect(() => {
    const container = sidebarRef.current;
    if (!container) return;
    const btn = container.children[focusedIdx] as HTMLElement | undefined;
    btn?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusedIdx]);

  // Playback auto-advance with countdown timer
  useEffect(() => {
    if (!playing) {
      setCountdown(0);
      return;
    }
    const seconds = Math.round(playSpeed / 1000);
    setCountdown(seconds);
    const tick = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          setFocusedIdx((prev) => {
            if (prev >= forceEntries.length - 1) {
              setPlaying(false);
              return prev;
            }
            return prev + 1;
          });
          return seconds;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [playing, playSpeed, forceEntries.length]);

  // Focused scene details for stepping
  const focusedScene = useMemo(() => {
    if (!narrative) return null;
    const entry = forceEntries[focusedIdx];
    if (!entry) return null;
    const scene = narrative.scenes[entry.sceneId];
    if (!scene) return null;
    const loc = narrative.locations[scene.locationId];
    const pov = narrative.characters[scene.povId];
    const participants = scene.participantIds.map((id) => narrative.characters[id]?.name).filter(Boolean);

    // Previous scene for transition context
    const prevEntry = focusedIdx > 0 ? forceEntries[focusedIdx - 1] : null;
    const prevScene = prevEntry ? narrative.scenes[prevEntry.sceneId] : null;
    const prevLoc = prevScene ? narrative.locations[prevScene.locationId] : null;
    const locationChanged = prevScene ? prevScene.locationId !== scene.locationId : false;
    const cornerChanged = prevEntry ? prevEntry.cornerKey !== entry.cornerKey : false;

    return {
      ...entry,
      summary: scene.summary,
      locationName: loc?.name ?? '—',
      povName: pov?.name ?? '—',
      participants,
      events: scene.events,
      pos: forcesToCubePos(entry.forces.drive, entry.forces.world, entry.forces.system),
      prevLocationName: prevLoc?.name ?? null,
      locationChanged,
      prevCornerName: prevEntry?.corner.name ?? null,
      cornerChanged,
    };
  }, [focusedIdx, forceEntries, narrative]);

  // Keyboard stepping: left/right arrows navigate scenes, Escape closes.
  // Uses capture phase + stopPropagation to prevent main timeline shortcuts from firing.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        if (forceEntries.length === 0) return;
        setPlaying(false);
        setFocusedIdx((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        if (forceEntries.length === 0) return;
        setPlaying(false);
        setFocusedIdx((prev) => Math.min(forceEntries.length - 1, prev + 1));
      } else if (e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        setPlaying((p) => {
          if (!p && focusedIdx >= forceEntries.length - 1) setFocusedIdx(0);
          return !p;
        });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [forceEntries.length, focusedIdx, onClose]);

  // Map focused scene to its trajectory index for canvas highlighting
  const focusedTrajectoryIdx = useMemo(() => {
    if (!narrative) return null;
    const entry = forceEntries[focusedIdx];
    if (!entry) return null;
    return resolvedKeys.indexOf(entry.sceneId);
  }, [focusedIdx, forceEntries, narrative, resolvedKeys]);

  // Compact trajectory stats for the header
  const trajectoryStats = useMemo(() => {
    if (forceEntries.length === 0) return null;
    const first = forceEntries[0];
    const last = forceEntries[forceEntries.length - 1];
    const cornerCounts: Record<string, number> = {};
    for (const e of forceEntries) cornerCounts[e.corner.name] = (cornerCounts[e.corner.name] ?? 0) + 1;
    const dominant = Object.entries(cornerCounts).sort((a, b) => b[1] - a[1])[0];
    const uniqueCorners = Object.keys(cornerCounts).length;
    let transitions = 0;
    for (let i = 1; i < forceEntries.length; i++) {
      if (forceEntries[i].cornerKey !== forceEntries[i - 1].cornerKey) transitions++;
    }
    return {
      first: first.corner.name,
      last: last.corner.name,
      sceneCount: forceEntries.length,
      dominant: dominant[0],
      dominantCount: dominant[1],
      uniqueCorners,
      transitions,
    };
  }, [forceEntries]);

  // Hover state for trajectory dots
  const [hoveredDotIdx, setHoveredDotIdx] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const projectedDotsRef = useRef<{ x: number; y: number; idx: number }[]>([]);

  // Mouse drag handlers
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragging.current) {
      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      setRotY((r) => r - dx * 0.008);
      setRotX((r) => Math.max(-1.2, Math.min(1.2, r - dy * 0.008)));
      lastMouse.current = { x: e.clientX, y: e.clientY };
      setHoveredDotIdx(null);
      setTooltipPos(null);
      return;
    }

    // Hit-test trajectory dots
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const HIT_RADIUS = 12;

    let closest: { idx: number; dist: number } | null = null;
    for (const dot of projectedDotsRef.current) {
      const dx = dot.x - mx;
      const dy = dot.y - my;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < HIT_RADIUS && (!closest || dist < closest.dist)) {
        closest = { idx: dot.idx, dist };
      }
    }

    if (closest) {
      setHoveredDotIdx(closest.idx);
      setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    } else {
      setHoveredDotIdx(null);
      setTooltipPos(null);
    }
  }, []);

  const onMouseUp = useCallback(() => {
    dragging.current = false;
  }, []);

  // Resolve hovered scene info
  const hoveredScene = useMemo(() => {
    if (hoveredDotIdx === null || !narrative) return null;
    const key = resolvedKeys[hoveredDotIdx];
    if (!key) return null;
    const entry = resolveEntry(narrative, key);
    if (!entry || !isScene(entry)) return null;
    const arc = narrative.arcs[entry.arcId];
    const loc = entry.locationId ? narrative.locations[entry.locationId] : null;
    const pt = trajectory[hoveredDotIdx];
    // pos layout from forcesToCubePos: [tanh(world), tanh(drive), tanh(system)]
    const corner = pt ? detectCubeCorner({ drive: pt.pos[1], world: pt.pos[0], system: pt.pos[2] }) : null;
    return {
      summary: entry.summary,
      arcName: arc?.name ?? entry.arcId,
      locationName: loc?.name ?? '—',
      events: entry.events,
      cornerName: corner?.name ?? '',
      index: hoveredDotIdx + 1,
      total: resolvedKeys.length,
    };
  }, [hoveredDotIdx, narrative, resolvedKeys, trajectory]);

  // Render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, w, h);

    const fov = 4;
    const scale = Math.min(w, h) * 0.32;

    function transform(p: Vec3): [number, number] {
      let v: Vec3 = [p[0] * scale, p[1] * scale, p[2] * scale];
      v = rotateY(v, rotY);
      v = rotateX(v, rotX);
      return project(v, w, h, fov * scale);
    }

    function depth(p: Vec3): number {
      let v: Vec3 = [p[0] * scale, p[1] * scale, p[2] * scale];
      v = rotateY(v, rotY);
      v = rotateX(v, rotX);
      return v[2];
    }

    // ── Resolve CSS colors ─────────────────────────────────────────────
    const style = getComputedStyle(canvas);
    function resolveCssColor(v: string): string {
      if (!v.startsWith('var(')) return v;
      return style.getPropertyValue(v.slice(4, -1)).trim() || '#888';
    }
    const driveColor = resolveCssColor('var(--color-drive)');
    const changeColor = resolveCssColor('var(--color-world)');
    const knowledgeColor = resolveCssColor('var(--color-system)');

    // ── Draw cube edges ────────────────────────────────────────────────
    for (const [a, b] of CUBE_EDGES) {
      const ca = CORNER_POSITIONS[a];
      const cb = CORNER_POSITIONS[b];
      const pa = transform(ca);
      const pb = transform(cb);

      // Cube axes: X = change, Y = drive, Z = knowledge
      const dx = Math.abs(ca[0] - cb[0]);
      const dy = Math.abs(ca[1] - cb[1]);
      const dz = Math.abs(ca[2] - cb[2]);
      let edgeColor: string;
      if (dx > dy && dx > dz) {
        edgeColor = changeColor;  // X axis
      } else if (dy > dz) {
        edgeColor = driveColor;  // Y axis
      } else {
        edgeColor = knowledgeColor;  // Z axis
      }

      ctx.strokeStyle = edgeColor;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // ── Draw axis lines + labels ────────────────────────────────────────
    const axes: { label: string; lo: Vec3; hi: Vec3; color: string }[] = [
      { label: 'World',  lo: [-1.35, 0, 0], hi: [1.35, 0, 0], color: changeColor },
      { label: 'Drive',  lo: [0, -1.35, 0], hi: [0, 1.35, 0], color: driveColor },
      { label: 'System', lo: [0, 0, -1.35], hi: [0, 0, 1.35], color: knowledgeColor },
    ];

    for (const ax of axes) {
      const pLo = transform(ax.lo);
      const pHi = transform(ax.hi);

      ctx.strokeStyle = ax.color;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(pLo[0], pLo[1]);
      ctx.lineTo(pHi[0], pHi[1]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      ctx.font = '9px system-ui, sans-serif';
      ctx.fillStyle = ax.color;
      ctx.globalAlpha = 0.6;
      ctx.textAlign = 'center';
      ctx.fillText('Lo', pLo[0], pLo[1] + 12);

      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.globalAlpha = 0.95;
      ctx.fillText(`${ax.label} Hi`, pHi[0], pHi[1] - 6);
      ctx.globalAlpha = 1;
    }

    // ── Draw corner labels ─────────────────────────────────────────────
    const cornerData = CORNER_KEYS.map((key, i) => ({
      key,
      name: NARRATIVE_CUBE[key].name,
      pos: CORNER_POSITIONS[i],
      screenPos: transform(CORNER_POSITIONS[i]),
      z: depth(CORNER_POSITIONS[i]),
    })).sort((a, b) => a.z - b.z);

    for (const cd of cornerData) {
      const isNearest = currentCorner?.key === cd.key;
      const opacity = isNearest ? 1 : 0.55;
      const radius = isNearest ? 5 : 3;

      ctx.beginPath();
      ctx.arc(cd.screenPos[0], cd.screenPos[1], radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
      ctx.fill();

      ctx.font = isNearest ? 'bold 10px system-ui, sans-serif' : '9px system-ui, sans-serif';
      ctx.fillStyle = `rgba(255, 255, 255, ${isNearest ? 1 : 0.5})`;
      ctx.textAlign = 'center';
      ctx.fillText(cd.name, cd.screenPos[0], cd.screenPos[1] - radius - 4);
    }

    // ── Draw trajectory ────────────────────────────────────────────────
    if (trajectory.length > 1) {
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 1; i < trajectory.length; i++) {
        const prev = transform(trajectory[i - 1].pos);
        const curr = transform(trajectory[i].pos);
        const progress = i / trajectory.length;
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.06 + progress * 0.12})`;
        ctx.beginPath();
        ctx.moveTo(prev[0], prev[1]);
        ctx.lineTo(curr[0], curr[1]);
        ctx.stroke();
      }
    }

    // ── Draw scene dots on trajectory ──────────────────────────────────
    const dots: { x: number; y: number; idx: number }[] = [];
    for (let i = 0; i < trajectory.length; i++) {
      const [sx, sy] = transform(trajectory[i].pos);
      dots.push({ x: sx, y: sy, idx: i });
      const isHovered = i === hoveredDotIdx;
      const isFocused = i === focusedTrajectoryIdx;
      const r = isFocused ? 6 : isHovered ? 4 : 2;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = isFocused
        ? '#facc15'
        : isHovered
          ? '#FFFFFF'
          : `rgba(255, 255, 255, ${0.15 + (i / trajectory.length) * 0.25})`;
      ctx.fill();

      if (isFocused) {
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, 10, 0, Math.PI * 2);
        ctx.stroke();
      } else if (isHovered) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, 8, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // ── Draw direction vector arrow ──────────────────────────────────
    if (focusedTrajectoryIdx !== null && focusedTrajectoryIdx > 0) {
      const prevPos = transform(trajectory[focusedTrajectoryIdx - 1].pos);
      const currPos = transform(trajectory[focusedTrajectoryIdx].pos);
      const dx = currPos[0] - prevPos[0];
      const dy = currPos[1] - prevPos[1];
      const len = Math.sqrt(dx * dx + dy * dy);

      if (len > 4) {
        const ux = dx / len;
        const uy = dy / len;

        // Draw the shaft — from previous dot edge to current dot edge
        const shaftStart = [prevPos[0] + ux * 4, prevPos[1] + uy * 4];
        const shaftEnd = [currPos[0] - ux * 8, currPos[1] - uy * 8];

        ctx.strokeStyle = 'rgba(250, 204, 21, 0.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(shaftStart[0], shaftStart[1]);
        ctx.lineTo(shaftEnd[0], shaftEnd[1]);
        ctx.stroke();

        // Draw arrowhead
        const headLen = 8;
        const headAngle = Math.PI / 6;
        const tipX = currPos[0] - ux * 7;
        const tipY = currPos[1] - uy * 7;
        const angle = Math.atan2(dy, dx);

        ctx.fillStyle = 'rgba(250, 204, 21, 0.9)';
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(
          tipX - headLen * Math.cos(angle - headAngle),
          tipY - headLen * Math.sin(angle - headAngle),
        );
        ctx.lineTo(
          tipX - headLen * Math.cos(angle + headAngle),
          tipY - headLen * Math.sin(angle + headAngle),
        );
        ctx.closePath();
        ctx.fill();
      }
    }

    projectedDotsRef.current = dots;
  }, [rotX, rotY, trajectory, currentCorner, hoveredDotIdx, focusedTrajectoryIdx]);


  return (
    <div className="fixed inset-0 bg-[#0a0a0f] z-60 flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between shrink-0">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-semibold text-text-primary">Narrative Cube</h2>
          {currentCorner && (
            <span className="flex items-center gap-2">
              <svg width="24" height="12" viewBox="0 0 24 12">
                {([0,1,2]).map((i) => {
                  const isHigh = currentCorner.key[i] === 'H';
                  const colors = ['#EF4444','#22C55E','#3B82F6'];
                  const barH = isHigh ? 9 : 4;
                  return <rect key={i} x={i * 9} y={12 - barH} width={7} height={barH} rx={1} fill={colors[i]} opacity={0.75} />;
                })}
              </svg>
              <span className="text-[11px] text-text-primary font-medium">{currentCorner.name}</span>
              {localPosition && (
                <>
                  <span className="text-white/15">|</span>
                  <span className="text-[10px] font-medium" style={{ color: { peak: '#F59E0B', trough: '#3B82F6', rising: '#22C55E', falling: '#EF4444', stable: 'rgba(255,255,255,0.4)' }[localPosition.key] }}>
                    {localPosition.name}
                  </span>
                </>
              )}
            </span>
          )}
          {trajectoryStats && (
            <>
              <span className="text-text-dim/30 text-[10px]">&middot;</span>
              <span className="text-[10px] text-text-dim">
                {trajectoryStats.sceneCount} scenes &middot; {trajectoryStats.uniqueCorners}/8 corners &middot; {trajectoryStats.transitions} transitions
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Global / Local toggle */}
          <div className="flex items-center rounded-full border border-white/10 overflow-hidden">
            <button
              onClick={() => setForceMode('global')}
              className={`text-[9px] px-2.5 py-0.5 transition ${
                forceMode === 'global'
                  ? 'bg-white/10 text-text-primary'
                  : 'text-text-dim hover:text-text-secondary'
              }`}
            >
              Global
            </button>
            <button
              onClick={() => setForceMode('local')}
              className={`text-[9px] px-2.5 py-0.5 transition ${
                forceMode === 'local'
                  ? 'bg-white/10 text-text-primary'
                  : 'text-text-dim hover:text-text-secondary'
              }`}
            >
              Local
            </button>
          </div>
          <span className="text-[10px] text-text-dim font-mono">
            {focusedIdx + 1} / {forceEntries.length}
          </span>
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text-primary text-lg leading-none transition"
          >
            &times;
          </button>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 overflow-hidden flex">
        {/* Scene list sidebar */}
        <div ref={sidebarRef} className="w-56 shrink-0 border-r border-white/10 overflow-y-auto py-2">
          {forceEntries.map((entry, i) => {
            const scene = narrative?.scenes[entry.sceneId];
            return (
              <button
                key={entry.sceneId}
                onClick={() => setFocusedIdx(i)}
                className={`w-full text-left px-4 py-2.5 transition-colors ${
                  i === focusedIdx
                    ? 'bg-white/8 text-text-primary'
                    : 'text-text-dim hover:bg-white/4 hover:text-text-secondary'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-text-dim shrink-0">
                    {i + 1}
                  </span>
                  <span className="text-[11px] truncate">
                    {(scene?.summary ?? '').slice(0, 60)}{(scene?.summary ?? '').length > 60 ? '...' : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 ml-5">
                  <span className="text-[9px] text-text-dim">{entry.arcName}</span>
                  <span className="text-[8px] text-yellow-400/50">{entry.corner.name}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Center: cube canvas + analysis below */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Cube */}
          <div className="flex-1 min-h-0 p-6 relative">
            <canvas
              ref={canvasRef}
              className="w-full h-full rounded-lg cursor-grab active:cursor-grabbing"
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={() => { onMouseUp(); setHoveredDotIdx(null); setTooltipPos(null); }}
            />
            {hoveredScene && tooltipPos && (
              <div
                className="absolute z-20 pointer-events-none bg-bg-surface/95 border border-white/10 rounded-lg px-3 py-2 shadow-lg max-w-55"
                style={{
                  left: Math.min(tooltipPos.x + 12 + 24, (canvasRef.current?.clientWidth ?? 300) - 200),
                  top: tooltipPos.y - 8 + 24,
                  transform: 'translateY(-100%)',
                }}
              >
                <div className="text-[9px] text-text-dim mb-1">
                  Scene {hoveredScene.index}/{hoveredScene.total} &middot; {hoveredScene.arcName}
                </div>
                <div className="text-[10px] text-text-secondary leading-snug mb-1">
                  {hoveredScene.summary.length > 120
                    ? hoveredScene.summary.slice(0, 120) + '...'
                    : hoveredScene.summary}
                </div>
                <div className="flex items-center gap-2 text-[9px] text-text-dim">
                  <span>{hoveredScene.locationName}</span>
                  <span className="text-text-dim/40">&middot;</span>
                  <span>{hoveredScene.cornerName}</span>
                </div>
              </div>
            )}
            <div className="absolute bottom-8 left-8 text-[9px] text-text-dim/60">
              Drag to rotate
            </div>
          </div>

          {/* Playback controls */}
          <div className="shrink-0 border-t border-white/10 px-6 py-2.5 flex items-center justify-between">
            <button
              onClick={() => { setPlaying(false); setFocusedIdx((prev) => Math.max(0, prev - 1)); }}
              disabled={focusedIdx === 0}
              className="text-[10px] px-3 py-1 rounded-full border border-white/8 text-text-dim hover:text-text-secondary hover:border-white/12 transition disabled:opacity-30 disabled:pointer-events-none flex items-center gap-1.5"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Prev
            </button>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  if (focusedIdx >= forceEntries.length - 1) setFocusedIdx(0);
                  setPlaying(true);
                }}
                disabled={playing}
                className="p-1.5 rounded-full border border-green-500/30 text-green-400 hover:bg-green-500/10 transition disabled:opacity-30 disabled:pointer-events-none"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="6,4 20,12 6,20" />
                </svg>
              </button>
              <button
                onClick={() => setPlaying(false)}
                disabled={!playing}
                className="p-1.5 rounded-full border border-white/10 text-text-dim hover:bg-white/5 transition disabled:opacity-30 disabled:pointer-events-none"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              </button>
              {playing && countdown > 0 && (
                <span className="text-[10px] font-mono text-text-dim tabular-nums w-6 text-center">
                  {countdown}s
                </span>
              )}
              <select
                value={playSpeed}
                onChange={(e) => setPlaySpeed(Number(e.target.value))}
                className="text-[9px] bg-transparent border border-white/10 rounded px-1.5 py-0.5 text-text-dim cursor-pointer"
              >
                <option value={5000}>5s</option>
                <option value={8000}>8s</option>
                <option value={10000}>10s</option>
                <option value={15000}>15s</option>
                <option value={20000}>20s</option>
              </select>
            </div>
            <button
              onClick={() => { setPlaying(false); setFocusedIdx((prev) => Math.min(forceEntries.length - 1, prev + 1)); }}
              disabled={focusedIdx === forceEntries.length - 1}
              className="text-[10px] px-3 py-1 rounded-full border border-white/8 text-text-dim hover:text-text-secondary hover:border-white/12 transition disabled:opacity-30 disabled:pointer-events-none flex items-center gap-1.5"
            >
              Next
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

        </div>

        {/* Right panel: focused scene detail */}
        <div className="w-72 shrink-0 border-l border-white/10 overflow-y-auto">
          {focusedScene && (
            <div className="p-5 space-y-4">
              {/* Transition badges */}
              {(focusedScene.locationChanged || focusedScene.cornerChanged) && (
                <div className="flex items-center gap-2 flex-wrap">
                  {focusedScene.locationChanged && focusedScene.prevLocationName && (
                    <span className="inline-flex items-center gap-1 text-[9px] bg-blue-500/10 text-blue-400/90 px-2 py-0.5 rounded-full">
                      <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                        <circle cx="12" cy="9" r="2.5" />
                      </svg>
                      {focusedScene.prevLocationName} &rarr; {focusedScene.locationName}
                    </span>
                  )}
                  {focusedScene.cornerChanged && focusedScene.prevCornerName && (
                    <span className="inline-flex items-center gap-1 text-[9px] bg-yellow-500/10 text-yellow-400/90 px-2 py-0.5 rounded-full">
                      {focusedScene.prevCornerName} &rarr; {focusedScene.corner.name}
                    </span>
                  )}
                </div>
              )}

              <div className="flex items-baseline justify-between">
                <div className="flex items-center gap-2">
                  <svg width="21" height="12" viewBox="0 0 21 12">
                    {focusedScene.cornerKey.split('').map((c, i) => {
                      const isHi = c === 'H';
                      const colors = ['#EF4444', '#22C55E', '#3B82F6'];
                      return (
                        <rect key={i} x={i * 8} y={isHi ? 1 : 6} width={6} height={isHi ? 10 : 5} rx={1}
                          fill={colors[i]} opacity={isHi ? 1 : 0.4} />
                      );
                    })}
                  </svg>
                  <span className="text-[11px] font-medium text-yellow-400/90">{focusedScene.corner.name}</span>
                </div>
                <span className="text-[9px] text-text-dim">{focusedScene.arcName}</span>
              </div>

              <p className="text-[11px] text-text-secondary leading-relaxed">{focusedScene.summary}</p>

              <div className="flex items-center gap-3 text-[9px] text-text-dim flex-wrap">
                <span className="flex items-center gap-1">
                  <svg className="w-2.5 h-2.5 text-text-dim/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                    <circle cx="12" cy="9" r="2.5" />
                  </svg>
                  {focusedScene.locationName}
                </span>
                <span className="text-text-dim/30">&middot;</span>
                <span className="flex items-center gap-1">
                  <svg className="w-2.5 h-2.5 text-text-dim/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  {focusedScene.povName}
                </span>
                {focusedScene.participants.length > 0 && (
                  <>
                    <span className="text-text-dim/30">&middot;</span>
                    <span className="truncate">{focusedScene.participants.join(', ')}</span>
                  </>
                )}
              </div>

              {/* Force values */}
              <div className="flex items-center gap-2.5 pt-1">
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-drive font-medium">P</span>
                  <div className="w-10 h-1 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full bg-drive rounded-full"
                      style={{ width: `${Math.max(5, (Math.tanh(focusedScene.forces.drive) + 1) * 50)}%` }}
                    />
                  </div>
                  <span className="text-[8px] font-mono text-text-dim/60">{focusedScene.forces.drive.toFixed(1)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-world font-medium">W</span>
                  <div className="w-10 h-1 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full bg-world rounded-full"
                      style={{ width: `${Math.max(5, (Math.tanh(focusedScene.forces.world) + 1) * 50)}%` }}
                    />
                  </div>
                  <span className="text-[8px] font-mono text-text-dim/60">{focusedScene.forces.world.toFixed(1)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-system font-medium">S</span>
                  <div className="w-10 h-1 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full bg-system rounded-full"
                      style={{ width: `${Math.max(5, (Math.tanh(focusedScene.forces.system) + 1) * 50)}%` }}
                    />
                  </div>
                  <span className="text-[8px] font-mono text-text-dim/60">{focusedScene.forces.system.toFixed(1)}</span>
                </div>
              </div>

              {/* Corner description */}
              <p className="text-[10px] text-text-dim/60 leading-relaxed italic pt-1">
                {focusedScene.corner.description}
              </p>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
