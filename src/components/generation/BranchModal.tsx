'use client';

import { useState, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { resolveSceneSequence } from '@/lib/narrative-utils';
import type { Branch, NarrativeState } from '@/types/narrative';

// ─── Colours ──────────────────────────────────────────────────────────────────

const BRANCH_COLORS = ['#60A5FA', '#A78BFA', '#34D399', '#F97316', '#F472B6', '#FBBF24'];
const bColor = (ci: number) => BRANCH_COLORS[ci % BRANCH_COLORS.length];

/** Stable colour index for a branch — based on its position in allBranches, not the grid column */
function stableBranchColor(branchId: string, allBranches: Branch[]): string {
  const idx = allBranches.findIndex(b => b.id === branchId);
  return bColor(idx >= 0 ? idx : 0);
}

// ─── Layout ───────────────────────────────────────────────────────────────────

const ROW_H = 36;
const COL_W = 22;
const DOT_R = 5;
const LPAD = 10;

// col 0 = leftmost (oldest fork); col numCols-1 = rightmost (current branch)
function colX(col: number): number {
  return LPAD + col * COL_W;
}

// ─── Grid builder ─────────────────────────────────────────────────────────────

type GridRow = { colEntryIds: (string | null)[] };
type ForkConnector = { fromRow: number; fromCol: number; toRow: number; toCol: number };

function buildGrid(
  allBranches: Branch[],
  activeBranchId: string | null,
  narrative: NarrativeState,
): { columns: { branchId: string }[]; rows: GridRow[]; forkConnectors: ForkConnector[] } {
  if (!activeBranchId || allBranches.length === 0) {
    return { columns: [], rows: [], forkConnectors: [] };
  }

  const byId = new Map(allBranches.map(b => [b.id, b]));

  // Full resolved sequences for every branch
  const seqs = new Map<string, string[]>();
  for (const b of allBranches) {
    seqs.set(b.id, resolveSceneSequence(narrative.branches, b.id));
  }

  // Topological sort of non-current branches (ancestors before descendants)
  const others: Branch[] = [];
  const added = new Set<string>();
  function addB(b: Branch) {
    if (added.has(b.id) || b.id === activeBranchId) return;
    if (b.parentBranchId) { const p = byId.get(b.parentBranchId); if (p) addB(p); }
    added.add(b.id);
    others.push(b);
  }
  allBranches.forEach(b => { if (b.id !== activeBranchId) addB(b); });

  // columns: others left, current rightmost
  const columns: { branchId: string }[] = [
    ...others.map(b => ({ branchId: b.id })),
    { branchId: activeBranchId },
  ];
  const numCols = columns.length;
  const currentCol = numCols - 1;
  const currentSeq = seqs.get(activeBranchId) ?? [];

  // Per-branch: find LCP with current seq and compute divergent entries
  type Track = { col: number; forkIdx: number; div: string[] };
  const tracks: Track[] = others.map((b, i) => {
    const seq = seqs.get(b.id) ?? [];
    let lcp = 0;
    while (lcp < currentSeq.length && lcp < seq.length && currentSeq[lcp] === seq[lcp]) lcp++;
    return { col: i, forkIdx: lcp - 1, div: seq.slice(lcp) };
  });

  const totalRows = Math.max(
    currentSeq.length,
    ...tracks.map(t => Math.max(0, t.forkIdx + 1) + t.div.length),
    1,
  );

  const rows: GridRow[] = Array.from({ length: totalRows }, () => ({
    colEntryIds: Array<string | null>(numCols).fill(null),
  }));

  // Current branch fills every row of its sequence
  for (let i = 0; i < currentSeq.length && i < totalRows; i++) {
    rows[i].colEntryIds[currentCol] = currentSeq[i];
  }

  // Other branches: only their divergent entries (no shared-ancestor dots)
  for (const t of tracks) {
    for (let j = 0; j < t.div.length; j++) {
      const row = t.forkIdx + 1 + j;
      if (row >= 0 && row < totalRows) rows[row].colEntryIds[t.col] = t.div[j];
    }
  }

  // Fork connectors: bezier from current branch at fork point → branch first entry
  const forkConnectors: ForkConnector[] = tracks
    .filter(t => t.div.length > 0 && t.forkIdx >= 0)
    .map(t => ({ fromRow: t.forkIdx, fromCol: currentCol, toRow: t.forkIdx + 1, toCol: t.col }));

  return { columns, rows, forkConnectors };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BranchModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [forkEntryId, setForkEntryId] = useState<string | null>(
    state.resolvedSceneKeys[state.currentSceneIndex] ?? null,
  );
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const allBranches = useMemo(
    () => (narrative ? Object.values(narrative.branches) : []),
    [narrative],
  );

  const { columns, rows, forkConnectors } = useMemo(
    () => narrative
      ? buildGrid(allBranches, state.activeBranchId, narrative)
      : { columns: [], rows: [], forkConnectors: [] },
    [allBranches, state.activeBranchId, narrative],
  );

  if (!narrative) return null;

  const numCols = columns.length;
  const currentCol = numCols - 1;
  const svgW = numCols > 0 ? LPAD + numCols * COL_W + 8 : 0;
  const totalHeight = rows.length * ROW_H;

  // Last row with a dot per branch (for head badges)
  const branchLastRow = new Map<string, number>();
  rows.forEach((row, ri) => {
    row.colEntryIds.forEach((eid, ci) => {
      if (eid != null) branchLastRow.set(columns[ci].branchId, ri);
    });
  });

  function entryLabel(id: string): string {
    const wb = narrative!.worldBuilds[id];
    if (wb) return wb.summary;
    return narrative!.scenes[id]?.summary ?? id;
  }

  function isWorldEntry(id: string): boolean {
    return !!narrative!.worldBuilds[id];
  }

  function handleRename(branchId: string) {
    if (!renameValue.trim()) { setRenamingId(null); return; }
    dispatch({ type: 'RENAME_BRANCH', branchId, name: renameValue.trim() });
    setRenamingId(null);
  }

  function getDescendants(branchId: string): Branch[] {
    const result: Branch[] = [];
    const queue = [branchId];
    while (queue.length > 0) {
      const id = queue.pop()!;
      allBranches.forEach((b) => {
        if (b.parentBranchId === id) {
          result.push(b);
          queue.push(b.id);
        }
      });
    }
    return result;
  }

  function wouldDeleteActiveBranch(branchId: string): boolean {
    if (branchId === state.activeBranchId) return true;
    const descendants = getDescendants(branchId);
    return descendants.some((b) => b.id === state.activeBranchId);
  }

  function handleDeleteClick(branchId: string) {
    if (wouldDeleteActiveBranch(branchId)) return;
    const descendants = getDescendants(branchId);
    if (descendants.length > 0) {
      setPendingDeleteId(branchId);
    } else {
      dispatch({ type: 'DELETE_BRANCH', branchId });
    }
  }

  function handleDeleteConfirm() {
    if (!pendingDeleteId) return;
    dispatch({ type: 'DELETE_BRANCH', branchId: pendingDeleteId });
    setPendingDeleteId(null);
  }

  function handleSwitch(branchId: string) {
    dispatch({ type: 'SWITCH_BRANCH', branchId });
    onClose();
  }

  function handleFork() {
    if (!forkEntryId) return;
    const name = newBranchName.trim() || `Branch ${allBranches.length + 1}`;
    dispatch({
      type: 'CREATE_BRANCH',
      branch: {
        id: `B-${Date.now()}`,
        name,
        parentBranchId: state.activeBranchId,
        forkEntryId,
        entryIds: [],
        createdAt: Date.now(),
      },
    });
    setNewBranchName('');
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
      <div className="glass max-w-2xl w-full rounded-2xl p-6 relative max-h-[85vh] flex flex-col">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-text-dim hover:text-text-primary text-lg leading-none"
        >
          &times;
        </button>

        <h2 className="text-sm font-semibold text-text-primary mb-4">Branches</h2>

        {/* ── Git graph ───────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto min-h-0 mb-4">
          {rows.length === 0 ? (
            <p className="text-xs text-text-dim text-center py-8">No commits yet. Generate some scenes first.</p>
          ) : (
            <div className="flex">
              {/* Single SVG for all spines, fork connectors, and dots */}
              <svg width={svgW} height={totalHeight} className="shrink-0">

                {/* Spine segments: between consecutive dots in each column */}
                {rows.map((row, ri) => {
                  if (ri === 0) return null;
                  return columns.map((_c, ci) => {
                    const prev = rows[ri - 1].colEntryIds[ci];
                    const curr = row.colEntryIds[ci];
                    if (!prev || !curr) return null;
                    const x = colX(ci);
                    const c = stableBranchColor(columns[ci].branchId, allBranches);
                    const y1 = (ri - 1) * ROW_H + ROW_H / 2 + DOT_R + 1;
                    const y2 = ri * ROW_H + ROW_H / 2 - DOT_R - 1;
                    return <line key={`sp-${ri}-${ci}`} x1={x} y1={y1} x2={x} y2={y2} stroke={c} strokeWidth={2} />;
                  });
                })}

                {/* Fork connectors: bezier from current branch fork point → branch first dot */}
                {forkConnectors.map((fc, i) => {
                  const x1 = colX(fc.fromCol);
                  const y1 = fc.fromRow * ROW_H + ROW_H / 2 + DOT_R + 1;
                  const x2 = colX(fc.toCol);
                  const y2 = fc.toRow * ROW_H + ROW_H / 2 - DOT_R - 1;
                  const midY = (y1 + y2) / 2;
                  const c = stableBranchColor(columns[fc.toCol].branchId, allBranches);
                  return (
                    <path
                      key={`fc-${i}`}
                      d={`M${x1} ${y1} C${x1} ${midY} ${x2} ${midY} ${x2} ${y2}`}
                      stroke={c}
                      strokeWidth={2}
                      fill="none"
                    />
                  );
                })}

                {/* Dots (drawn on top of spines) */}
                {rows.map((row, ri) =>
                  row.colEntryIds.map((eid, ci) => {
                    if (!eid) return null;
                    const x = colX(ci);
                    const cy = ri * ROW_H + ROW_H / 2;
                    const c = stableBranchColor(columns[ci].branchId, allBranches);
                    return isWorldEntry(eid) ? (
                      <rect
                        key={`d-${ri}-${ci}`}
                        x={x - DOT_R + 1} y={cy - DOT_R + 1}
                        width={(DOT_R - 1) * 2} height={(DOT_R - 1) * 2}
                        rx={1} fill={c}
                        transform={`rotate(45 ${x} ${cy})`}
                      />
                    ) : (
                      <circle key={`d-${ri}-${ci}`} cx={x} cy={cy} r={DOT_R} fill={c} />
                    );
                  })
                )}
              </svg>

              {/* Labels column */}
              <div className="flex-1 min-w-0">
                {rows.map((row, ri) => {
                  // Label from current branch; fall back to any non-null
                  const labelEntryId =
                    row.colEntryIds[currentCol] ??
                    row.colEntryIds.find(e => e != null) ??
                    null;
                  const labelIsActive = row.colEntryIds[currentCol] != null;

                  const headCols = columns
                    .map((c, ci) => ({ ci, branchId: c.branchId }))
                    .filter(({ ci, branchId }) =>
                      branchLastRow.get(branchId) === ri && row.colEntryIds[ci] != null,
                    );

                  return (
                    <div key={ri} style={{ height: ROW_H }} className="flex items-center pl-2 gap-2">
                      {labelEntryId && (
                        <>
                          <p className={`flex-1 text-xs truncate leading-tight ${labelIsActive ? 'text-text-primary' : 'text-text-secondary'}`}>
                            {entryLabel(labelEntryId).slice(0, 80)}
                          </p>
                          {headCols.length > 0 && (
                            <div className="flex gap-1 shrink-0">
                              {headCols.map(({ branchId }) => {
                                const branch = narrative!.branches[branchId];
                                const isActive = branchId === state.activeBranchId;
                                const c = stableBranchColor(branchId, allBranches);
                                return (
                                  <button
                                    key={branchId}
                                    onClick={() => handleSwitch(branchId)}
                                    className="px-1.5 py-0.5 rounded text-[9px] font-semibold transition-opacity hover:opacity-80"
                                    style={{
                                      backgroundColor: isActive ? c : `${c}33`,
                                      color: isActive ? '#000' : c,
                                    }}
                                  >
                                    {branch?.name ?? branchId}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Branch list ─────────────────────────────────────────────────── */}
        <div className="border-t border-border pt-4 mb-4">
          <p className="text-[10px] text-text-dim uppercase tracking-widest mb-2">All Branches</p>
          <div className="flex flex-col gap-0.5">
            {allBranches.map((b) => {
              const isActive = b.id === state.activeBranchId;
              const isRenaming = renamingId === b.id;
              const c = stableBranchColor(b.id, allBranches);
              return (
                <div
                  key={b.id}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors ${isActive ? 'bg-white/6' : 'hover:bg-white/4'}`}
                >
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c }} />
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => handleRename(b.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename(b.id);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      className="flex-1 bg-transparent text-xs text-text-primary outline-none border-b border-white/20"
                    />
                  ) : (
                    <button onClick={() => handleSwitch(b.id)} className="flex-1 text-left text-xs text-text-primary">
                      {b.name}
                      {isActive && <span className="ml-2 text-[9px] text-text-dim">current</span>}
                    </button>
                  )}
                  <div className="flex gap-0.5 shrink-0">
                    {pendingDeleteId === b.id ? (
                      <>
                        <span className="text-[10px] text-red-400/80 px-1 self-center">
                          Also deletes {getDescendants(b.id).length} child branch{getDescendants(b.id).length !== 1 ? 'es' : ''}. Confirm?
                        </span>
                        <button
                          onClick={handleDeleteConfirm}
                          className="text-[10px] text-red-400 px-1.5 py-0.5 rounded bg-red-500/15 hover:bg-red-500/25 transition-colors"
                        >
                          yes
                        </button>
                        <button
                          onClick={() => setPendingDeleteId(null)}
                          className="text-[10px] text-text-dim hover:text-text-secondary px-1.5 py-0.5 rounded hover:bg-white/6 transition-colors"
                        >
                          cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => { setRenamingId(b.id); setRenameValue(b.name); }}
                          className="text-[10px] text-text-dim hover:text-text-secondary px-1.5 py-0.5 rounded hover:bg-white/6 transition-colors"
                        >
                          rename
                        </button>
                        {!isActive && (
                          <button
                            onClick={() => handleDeleteClick(b.id)}
                            disabled={wouldDeleteActiveBranch(b.id)}
                            title={wouldDeleteActiveBranch(b.id) ? 'Cannot delete — current branch depends on this one' : undefined}
                            className="text-[10px] px-1.5 py-0.5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-red-400/50 hover:text-red-400 hover:bg-red-500/10 disabled:hover:text-red-400/50 disabled:hover:bg-transparent"
                          >
                            delete
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── New branch ───────────────────────────────────────────────────── */}
        <div className="border-t border-border pt-4">
          <p className="text-[10px] text-text-dim uppercase tracking-widest mb-3">New Branch</p>
          <div className="flex flex-col gap-3">
            <input
              type="text"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              placeholder={`Branch ${allBranches.length + 1}`}
              className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full outline-none placeholder:text-text-dim"
            />
            <div>
              <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-1">Fork After</label>
              <select
                value={forkEntryId ?? ''}
                onChange={(e) => setForkEntryId(e.target.value || null)}
                className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full outline-none"
              >
                {state.resolvedSceneKeys.map((key, idx) => {
                  const label = narrative!.worldBuilds[key]
                    ? narrative!.worldBuilds[key].summary
                    : (narrative!.scenes[key]?.summary ?? key);
                  return (
                    <option key={key} value={key} className="bg-bg-panel">
                      {idx + 1}. {label.slice(0, 72)}{label.length > 72 ? '…' : ''}
                    </option>
                  );
                })}
              </select>
            </div>
            <button
              onClick={handleFork}
              disabled={!forkEntryId}
              className="bg-white/10 hover:bg-white/16 text-text-primary font-semibold px-4 py-2.5 rounded-lg transition disabled:opacity-30 disabled:pointer-events-none"
            >
              Create Branch
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
