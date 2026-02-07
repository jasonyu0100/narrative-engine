'use client';

import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { useStore } from '@/lib/store';
import { resolveEntry, isScene, NARRATIVE_CUBE, type CubeCorner, type CubeCornerKey, type Scene } from '@/types/narrative';
import { detectCubeCorner, computeForceSnapshots } from '@/lib/narrative-utils';
import { analyzeForceTrajectory } from '@/lib/ai';

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

// ── Force data type for AI analysis ──────────────────────────────────────────

type SceneForceEntry = {
  sceneId: string;
  arcId: string;
  arcName: string;
  corner: CubeCorner;
  cornerKey: CubeCornerKey;
  forces: { stakes: number; pacing: number; variety: number };
};

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

  // AI analysis state
  const [analysisText, setAnalysisText] = useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);

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

  // Build per-scene force entries for AI analysis
  const forceEntries = useMemo((): SceneForceEntry[] => {
    if (!narrative) return [];
    const allScenes = resolvedKeys
      .map((k) => resolveEntry(narrative, k))
      .filter((e): e is Scene => !!e && isScene(e));
    const forceMap = computeForceSnapshots(allScenes);

    const entries: SceneForceEntry[] = [];
    for (let i = 0; i < resolvedKeys.length; i++) {
      const entry = resolveEntry(narrative, resolvedKeys[i]);
      if (entry && isScene(entry)) {
        const f = forceMap[entry.id];
        if (f) {
          const arc = narrative.arcs[entry.arcId];
          const corner = detectCubeCorner(f);
          entries.push({
            sceneId: entry.id,
            arcId: entry.arcId,
            arcName: arc?.name ?? entry.arcId,
            corner,
            cornerKey: corner.key,
            forces: f,
          });
        }
      }
    }
    return entries;
  }, [narrative, resolvedKeys]);

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

  // Run AI analysis
  const runAnalysis = useCallback(async () => {
    if (!narrative || forceEntries.length === 0) return;
    setAnalysisLoading(true);
    setAnalysisError(null);
    setShowAnalysis(true);
    try {
      const result = await analyzeForceTrajectory(
        narrative,
        forceEntries.map(e => ({
          sceneId: e.sceneId,
          arcId: e.arcId,
          arcName: e.arcName,
          forces: e.forces,
          corner: e.corner.name,
          cornerKey: e.cornerKey,
        })),
      );
      setAnalysisText(result);
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setAnalysisLoading(false);
    }
  }, [narrative, forceEntries]);

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
    for (const [a, b] of CUBE_EDGES) {
      const ca = CORNER_POSITIONS[a];
      const cb = CORNER_POSITIONS[b];
      const pa = transform(ca);
      const pb = transform(cb);

      const dx = Math.abs(ca[0] - cb[0]);
      const dy = Math.abs(ca[1] - cb[1]);
      const dz = Math.abs(ca[2] - cb[2]);
      let edgeColor: string;
      if (dx > dy && dx > dz) {
        edgeColor = stakesColor;
      } else if (dy > dz) {
        edgeColor = pacingColor;
      } else {
        edgeColor = varietyColor;
      }

      ctx.strokeStyle = edgeColor;
      ctx.globalAlpha = 0.25;
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

      ctx.font = '9px system-ui, sans-serif';
      ctx.fillStyle = ax.color;
      ctx.globalAlpha = 0.45;
      ctx.textAlign = 'center';
      ctx.fillText('Lo', pLo[0], pLo[1] + 12);

      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.globalAlpha = 0.85;
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
      const opacity = isNearest ? 1 : 0.4;
      const radius = isNearest ? 5 : 3;

      ctx.beginPath();
      ctx.arc(cd.screenPos[0], cd.screenPos[1], radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
      ctx.fill();

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

  // Parse AI analysis into sections for rendering
  const analysisSections = useMemo(() => {
    if (!analysisText) return [];
    const sections: { title: string; body: string }[] = [];
    const sectionNames = ['Trajectory Overview', 'Arc-by-Arc Dynamics', 'Tension Architecture', 'Pacing Rhythm', 'Compositional Observations'];

    // Try to split by section headers
    let remaining = analysisText.trim();
    for (let i = 0; i < sectionNames.length; i++) {
      const name = sectionNames[i];
      const idx = remaining.indexOf(name);
      if (idx === -1) continue;

      const nextIdx = i < sectionNames.length - 1
        ? sectionNames.slice(i + 1).reduce((best, n) => {
            const found = remaining.indexOf(n, idx + name.length);
            return found !== -1 && (best === -1 || found < best) ? found : best;
          }, -1)
        : -1;

      const body = nextIdx !== -1
        ? remaining.slice(idx + name.length, nextIdx).trim()
        : remaining.slice(idx + name.length).trim();

      sections.push({ title: name, body });
      if (nextIdx !== -1) remaining = remaining.slice(nextIdx);
      else break;
    }

    // Fallback: if no sections found, treat as single block
    if (sections.length === 0 && analysisText.trim()) {
      sections.push({ title: 'Analysis', body: analysisText.trim() });
    }

    return sections;
  }, [analysisText]);

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div
        className="glass rounded-2xl relative flex flex-col overflow-hidden"
        style={{ width: showAnalysis ? 780 : 520, maxHeight: '92vh', transition: 'width 0.3s ease' }}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-white/5">
          <div className="flex items-baseline justify-between">
            <div className="flex items-baseline gap-3">
              <h2 className="text-sm font-semibold text-text-primary">Narrative Cube</h2>
              {currentCorner && (
                <span className="text-[11px] text-text-secondary">
                  <span className="text-text-primary font-medium">{currentCorner.name}</span>
                  <span className="text-text-dim font-mono ml-1.5 text-[9px]">{currentCorner.key}</span>
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-text-dim hover:text-text-primary text-lg leading-none"
            >
              &times;
            </button>
          </div>

          {/* Compact stats bar */}
          {trajectoryStats && (
            <div className="flex items-center gap-4 mt-2 text-[10px] text-text-dim">
              <span>{trajectoryStats.sceneCount} scenes</span>
              <span className="text-text-dim/40">|</span>
              <span>{trajectoryStats.first} &rarr; {trajectoryStats.last}</span>
              <span className="text-text-dim/40">|</span>
              <span>{trajectoryStats.uniqueCorners}/8 corners</span>
              <span className="text-text-dim/40">|</span>
              <span>{trajectoryStats.transitions} transitions</span>
              <span className="text-text-dim/40">|</span>
              <span>dominant: <span className="text-text-secondary">{trajectoryStats.dominant}</span></span>
            </div>
          )}
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className={`flex min-h-0 ${showAnalysis ? 'flex-1' : ''}`}>
            {/* Cube canvas */}
            <div className={`p-4 ${showAnalysis ? 'w-[340px] shrink-0' : 'w-full'}`} style={{ transition: 'width 0.3s ease' }}>
              <p className="text-[10px] text-text-dim mb-2">
                Drag to rotate. Path shows the story&apos;s journey through force space.
              </p>
              <canvas
                ref={canvasRef}
                className="w-full rounded-lg cursor-grab active:cursor-grabbing"
                style={{ height: showAnalysis ? 320 : 380 }}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={onMouseUp}
              />
            </div>

            {/* Analysis panel */}
            {showAnalysis && (
              <div className="flex-1 border-l border-white/5 overflow-y-auto" style={{ maxHeight: 'calc(92vh - 140px)' }}>
                {analysisLoading && (
                  <div className="flex flex-col items-center justify-center h-full py-16 gap-3">
                    <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                    <p className="text-[11px] text-text-dim">Analyzing force trajectory...</p>
                  </div>
                )}

                {analysisError && (
                  <div className="p-5">
                    <p className="text-[11px] text-red-400/80">{analysisError}</p>
                    <button
                      onClick={runAnalysis}
                      className="mt-2 text-[10px] px-3 py-1 rounded-full border border-white/10 text-text-dim hover:text-text-secondary transition"
                    >
                      Retry
                    </button>
                  </div>
                )}

                {!analysisLoading && !analysisError && analysisSections.length > 0 && (
                  <div className="p-5 space-y-4">
                    {analysisSections.map((section, i) => (
                      <div key={i}>
                        <h3 className="text-[10px] uppercase tracking-wider text-text-dim font-mono mb-1.5">
                          {section.title}
                        </h3>
                        <p className="text-[11px] text-text-secondary leading-[1.6]">
                          {section.body}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {!analysisLoading && !analysisError && analysisSections.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full py-16 gap-2">
                    <p className="text-[11px] text-text-dim">No analysis yet.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-white/5 flex items-center justify-between">
          <div className="text-[9px] text-text-dim/50">
            Stakes &middot; Pacing &middot; Variety
          </div>
          <div className="flex items-center gap-2">
            {showAnalysis && analysisText && (
              <button
                onClick={runAnalysis}
                disabled={analysisLoading}
                className="text-[10px] px-3 py-1 rounded-full border border-white/8 text-text-dim hover:text-text-secondary hover:border-white/12 transition disabled:opacity-40"
              >
                Re-analyze
              </button>
            )}
            <button
              onClick={() => {
                if (!showAnalysis && !analysisText) {
                  runAnalysis();
                } else {
                  setShowAnalysis((v) => !v);
                }
              }}
              disabled={analysisLoading || forceEntries.length === 0}
              className={`text-[10px] px-3.5 py-1.5 rounded-full border transition disabled:opacity-40 ${
                showAnalysis
                  ? 'bg-white/10 border-white/20 text-text-primary'
                  : 'bg-transparent border-border text-text-dim hover:text-text-secondary hover:border-white/12'
              }`}
            >
              {analysisLoading ? 'Analyzing...' : showAnalysis ? 'Hide Analysis' : 'Analyze Trajectory'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
