'use client';

import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { useStore } from '@/lib/store';
import { resolveEntry, isScene, NARRATIVE_CUBE, type CubeCornerKey, type Scene } from '@/types/narrative';
import { detectCubeCorner, computeForceSnapshots } from '@/lib/narrative-utils';

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

// Map force values (-1 to +1) directly to cube coordinates
function forcesToCubePos(s: number, p: number, v: number): Vec3 {
  return [s, p, v];
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
  return forcesToCubePos(c.stakes, c.pacing, c.variety);
});

// ── Component ────────────────────────────────────────────────────────────────

export function NarrativeCubeViewer({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { state } = useStore();
  const narrative = state.activeNarrative;
  const resolvedKeys = state.resolvedSceneKeys;

  // Rotation state
  const [rotY, setRotY] = useState(-0.6);
  const [rotX, setRotX] = useState(0.4);
  const dragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  // Build force trajectory from all scenes
  const trajectory = useMemo(() => {
    if (!narrative) return [];
    const allScenes = resolvedKeys
      .map((k) => resolveEntry(narrative, k))
      .filter((e): e is Scene => !!e && isScene(e));
    const forceMap = computeForceSnapshots(allScenes);
    const pts: { pos: Vec3; index: number }[] = [];
    let lastForce = { stakes: 0, pacing: 0, variety: 0 };
    for (let i = 0; i < resolvedKeys.length; i++) {
      const entry = resolveEntry(narrative, resolvedKeys[i]);
      if (entry && isScene(entry)) {
        lastForce = forceMap[entry.id] ?? lastForce;
      }
      pts.push({
        pos: forcesToCubePos(lastForce.stakes, lastForce.pacing, lastForce.variety),
        index: i,
      });
    }
    return pts;
  }, [narrative, resolvedKeys]);

  // Current scene position
  const currentIdx = state.currentSceneIndex;
  const currentCorner = useMemo(() => {
    if (!narrative || trajectory.length === 0 || currentIdx < 0 || currentIdx >= trajectory.length) return null;
    const pos = trajectory[currentIdx].pos;
    return detectCubeCorner({
      stakes: pos[0],
      pacing: pos[1],
      variety: pos[2],
    });
  }, [narrative, trajectory, currentIdx]);

  // Mouse drag handlers
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    setRotY((r) => r - dx * 0.008);
    setRotX((r) => Math.max(-1.2, Math.min(1.2, r - dy * 0.008)));
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onMouseUp = useCallback(() => {
    dragging.current = false;
  }, []);

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
    const stakesColor = resolveCssColor('var(--color-stakes)');
    const pacingColor = resolveCssColor('var(--color-pacing)');
    const varietyColor = resolveCssColor('var(--color-variety)');

    // ── Draw cube edges ────────────────────────────────────────────────
    // Color edges by which axis they run along
    for (const [a, b] of CUBE_EDGES) {
      const ca = CORNER_POSITIONS[a];
      const cb = CORNER_POSITIONS[b];
      const pa = transform(ca);
      const pb = transform(cb);

      // Determine which axis this edge runs along
      const dx = Math.abs(ca[0] - cb[0]);
      const dy = Math.abs(ca[1] - cb[1]);
      const dz = Math.abs(ca[2] - cb[2]);
      let edgeColor: string;
      let edgeAlpha: number;
      if (dx > dy && dx > dz) {
        edgeColor = stakesColor; edgeAlpha = 0.25;
      } else if (dy > dz) {
        edgeColor = pacingColor; edgeAlpha = 0.25;
      } else {
        edgeColor = varietyColor; edgeAlpha = 0.25;
      }

      ctx.strokeStyle = edgeColor;
      ctx.globalAlpha = edgeAlpha;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // ── Draw axis lines + labels ────────────────────────────────────────
    const axes: { label: string; lo: Vec3; hi: Vec3; color: string }[] = [
      { label: 'Stakes',  lo: [-1.35, -1, -1], hi: [1.35, -1, -1], color: stakesColor },
      { label: 'Pacing',  lo: [-1, -1.35, -1], hi: [-1, 1.35, -1], color: pacingColor },
      { label: 'Variety', lo: [-1, -1, -1.35], hi: [-1, -1, 1.35], color: varietyColor },
    ];

    for (const ax of axes) {
      const pLo = transform(ax.lo);
      const pHi = transform(ax.hi);

      // Axis line
      ctx.strokeStyle = ax.color;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(pLo[0], pLo[1]);
      ctx.lineTo(pHi[0], pHi[1]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // "Lo" label
      ctx.font = '9px system-ui, sans-serif';
      ctx.fillStyle = ax.color;
      ctx.globalAlpha = 0.45;
      ctx.textAlign = 'center';
      ctx.fillText('Lo', pLo[0], pLo[1] + 12);

      // "Hi" label + axis name
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.globalAlpha = 0.85;
      ctx.fillText(`${ax.label} Hi`, pHi[0], pHi[1] - 6);
      ctx.globalAlpha = 1;
    }

    // ── Draw corner labels ─────────────────────────────────────────────
    // Sort by depth so back labels draw first
    const cornerData = CORNER_KEYS.map((key, i) => ({
      key,
      name: NARRATIVE_CUBE[key].name,
      pos: CORNER_POSITIONS[i],
      screenPos: transform(CORNER_POSITIONS[i]),
      z: depth(CORNER_POSITIONS[i]),
    })).sort((a, b) => a.z - b.z);

    for (const cd of cornerData) {
      const isNearest = currentCorner?.key === cd.key;
      const opacity = isNearest ? 1 : 0.4;
      const radius = isNearest ? 5 : 3;

      // Corner dot
      ctx.beginPath();
      ctx.arc(cd.screenPos[0], cd.screenPos[1], radius, 0, Math.PI * 2);
      ctx.fillStyle = isNearest
        ? `rgba(255, 255, 255, ${opacity})`
        : `rgba(255, 255, 255, ${opacity})`;
      ctx.fill();

      // Corner name
      ctx.font = isNearest ? 'bold 10px system-ui, sans-serif' : '9px system-ui, sans-serif';
      ctx.fillStyle = `rgba(255, 255, 255, ${isNearest ? 0.95 : 0.35})`;
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
        const alpha = 0.15 + progress * 0.6;

        ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(prev[0], prev[1]);
        ctx.lineTo(curr[0], curr[1]);
        ctx.stroke();
      }
    }

    // ── Draw scene dots on trajectory ──────────────────────────────────
    for (let i = 0; i < trajectory.length; i++) {
      const [sx, sy] = transform(trajectory[i].pos);
      const isCurrent = i === currentIdx;
      ctx.beginPath();
      ctx.arc(sx, sy, isCurrent ? 5 : 2, 0, Math.PI * 2);
      ctx.fillStyle = isCurrent
        ? '#FFFFFF'
        : `rgba(255, 255, 255, ${0.15 + (i / trajectory.length) * 0.4})`;
      ctx.fill();

      if (isCurrent) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, 8, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }, [rotX, rotY, trajectory, currentIdx, currentCorner]);

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
      <div className="glass rounded-2xl p-5 relative" style={{ width: 560, height: 480 }}>
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-text-dim hover:text-text-primary text-lg leading-none z-10"
        >
          &times;
        </button>

        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-semibold text-text-primary">
            Narrative Cube
          </h2>
          {currentCorner && (
            <span className="text-[11px] text-text-secondary">
              Current: <span className="text-text-primary font-medium">{currentCorner.name}</span>
              <span className="text-text-dim font-mono ml-1.5 text-[9px]">{currentCorner.key}</span>
            </span>
          )}
        </div>

        <p className="text-[10px] text-text-dim mb-2">
          Drag to rotate. The path shows your story&apos;s journey through the force space.
        </p>

        <canvas
          ref={canvasRef}
          className="w-full rounded-lg cursor-grab active:cursor-grabbing"
          style={{ height: 380 }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        />
      </div>
    </div>
  );
}
