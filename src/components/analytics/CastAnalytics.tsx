'use client';

import { useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { resolveEntry, isScene } from '@/types/narrative';
import type { Scene } from '@/types/narrative';
import { computeWorldMetrics, type WorldMetrics } from '@/lib/ai';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/Modal';

type Props = { onClose: () => void };
type View = 'cast' | 'locations' | 'tools' | 'metrics';

// ── Types ────────────────────────────────────────────────────────────────────

type CharacterStat = {
  id: string;
  name: string;
  role: 'anchor' | 'recurring' | 'transient';
  sceneCount: number;
  povCount: number;
  firstIndex: number;
  lastIndex: number;
  /** How many scenes since last appearance */
  staleness: number;
  /** Scene indices where this character participates */
  presence: boolean[];
};

type LocationStat = {
  id: string;
  name: string;
  parentName: string | null;
  sceneCount: number;
  firstIndex: number;
  lastIndex: number;
  staleness: number;
  presence: boolean[];
  /** Number of unique characters who have visited */
  uniqueVisitors: number;
};

type ArtifactStat = {
  id: string;
  name: string;
  significance: 'key' | 'notable' | 'minor';
  ownerName: string | null;
  ownerType: 'character' | 'location' | 'world';
  usageCount: number;
  /** Unique characters who have used this artifact */
  uniqueUsers: number;
  firstIndex: number;
  lastIndex: number;
  staleness: number;
  presence: boolean[];
  /** Character names who used it, with count */
  userBreakdown: { name: string; count: number }[];
};

const SIGNIFICANCE_COLORS: Record<string, string> = {
  key: '#f59e0b',
  notable: '#d97706',
  minor: '#6b7280',
};

// ── Role colors ──────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  anchor: '#f59e0b',
  recurring: '#3b82f6',
  transient: '#6b7280',
};

// ── Metric card ──────────────────────────────────────────────────────────────

function MetricCard({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-lg border p-2.5 ${warn ? 'border-amber-500/20 bg-amber-500/5' : 'border-white/6 bg-white/2'}`}>
      <div className={`text-[12px] font-medium ${warn ? 'text-amber-400' : 'text-text-primary'}`}>{value}</div>
      <div className="text-[10px] text-text-dim">{label}</div>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function CastAnalytics({ onClose }: Props) {
  const { state } = useStore();
  const narrative = state.activeNarrative;
  const [view, setView] = useState<View>('cast');
  const [sortBy, setSortBy] = useState<'scenes' | 'staleness' | 'name'>('scenes');

  // Resolve all scenes in order
  const allScenes = useMemo(() => {
    if (!narrative) return [];
    return state.resolvedEntryKeys
      .map((k) => resolveEntry(narrative, k))
      .filter((e): e is Scene => e !== null && isScene(e));
  }, [narrative, state.resolvedEntryKeys]);

  // ── Character stats ──────────────────────────────────────────────────

  const characterStats = useMemo((): CharacterStat[] => {
    if (!narrative || allScenes.length === 0) return [];

    const stats = new Map<string, { scenes: number; pov: number; first: number; last: number; presence: boolean[] }>();

    for (const [i, scene] of allScenes.entries()) {
      // POV
      const existing = stats.get(scene.povId);
      if (existing) {
        existing.pov++;
        existing.scenes++;
        existing.last = i;
        existing.presence[i] = true;
      } else {
        const presence = new Array(allScenes.length).fill(false);
        presence[i] = true;
        stats.set(scene.povId, { scenes: 1, pov: 1, first: i, last: i, presence });
      }

      // Participants (excluding POV to avoid double count)
      for (const pid of scene.participantIds) {
        if (pid === scene.povId) continue;
        const ex = stats.get(pid);
        if (ex) {
          ex.scenes++;
          ex.last = i;
          ex.presence[i] = true;
        } else {
          const presence = new Array(allScenes.length).fill(false);
          presence[i] = true;
          stats.set(pid, { scenes: 1, pov: 0, first: i, last: i, presence });
        }
      }
    }

    const totalScenes = allScenes.length;
    return Array.from(stats.entries())
      .map(([id, s]) => {
        const char = narrative.characters[id];
        if (!char) return null;
        return {
          id,
          name: char.name,
          role: char.role as 'anchor' | 'recurring' | 'transient',
          sceneCount: s.scenes,
          povCount: s.pov,
          firstIndex: s.first,
          lastIndex: s.last,
          staleness: totalScenes - 1 - s.last,
          presence: s.presence,
        };
      })
      .filter((s): s is CharacterStat => s !== null);
  }, [narrative, allScenes]);

  // ── Location stats ───────────────────────────────────────────────────

  const locationStats = useMemo((): LocationStat[] => {
    if (!narrative || allScenes.length === 0) return [];

    const stats = new Map<string, { scenes: number; first: number; last: number; presence: boolean[]; visitors: Set<string> }>();

    for (const [i, scene] of allScenes.entries()) {
      const locId = scene.locationId;
      const ex = stats.get(locId);
      if (ex) {
        ex.scenes++;
        ex.last = i;
        ex.presence[i] = true;
        for (const pid of scene.participantIds) ex.visitors.add(pid);
      } else {
        const presence = new Array(allScenes.length).fill(false);
        presence[i] = true;
        stats.set(locId, { scenes: 1, first: i, last: i, presence, visitors: new Set(scene.participantIds) });
      }
    }

    const totalScenes = allScenes.length;
    return Array.from(stats.entries())
      .map(([id, s]) => {
        const loc = narrative.locations[id];
        if (!loc) return null;
        const parentName = loc.parentId ? narrative.locations[loc.parentId]?.name ?? null : null;
        return {
          id,
          name: loc.name,
          parentName,
          sceneCount: s.scenes,
          firstIndex: s.first,
          lastIndex: s.last,
          staleness: totalScenes - 1 - s.last,
          presence: s.presence,
          uniqueVisitors: s.visitors.size,
        };
      })
      .filter((s): s is LocationStat => s !== null);
  }, [narrative, allScenes]);

  // ── Artifact stats ───────────────────────────────────────────────

  const artifactStats = useMemo((): ArtifactStat[] => {
    if (!narrative || allScenes.length === 0) return [];

    const stats = new Map<string, { usages: number; first: number; last: number; presence: boolean[]; users: Map<string, number> }>();

    for (const [i, scene] of allScenes.entries()) {
      for (const au of scene.artifactUsages ?? []) {
        const ex = stats.get(au.artifactId);
        if (ex) {
          ex.usages++;
          ex.last = i;
          ex.presence[i] = true;
          if (au.characterId) ex.users.set(au.characterId, (ex.users.get(au.characterId) ?? 0) + 1);
        } else {
          const presence = new Array(allScenes.length).fill(false);
          presence[i] = true;
          const users = new Map<string, number>();
          if (au.characterId) users.set(au.characterId, 1);
          stats.set(au.artifactId, { usages: 1, first: i, last: i, presence, users });
        }
      }
    }

    // Also include artifacts with zero usage so they show as stale
    for (const art of Object.values(narrative.artifacts ?? {})) {
      if (!stats.has(art.id)) {
        stats.set(art.id, { usages: 0, first: -1, last: -1, presence: new Array(allScenes.length).fill(false), users: new Map() });
      }
    }

    const totalScenes = allScenes.length;
    return Array.from(stats.entries())
      .map(([id, s]) => {
        const art = narrative.artifacts[id];
        if (!art) return null;
        const isWorldOwned = !art.parentId;
        const ownerType: 'character' | 'location' | 'world' = isWorldOwned ? 'world'
          : narrative.characters[art.parentId!] ? 'character' : 'location';
        const ownerName = isWorldOwned ? null
          : (narrative.characters[art.parentId!]?.name ?? narrative.locations[art.parentId!]?.name ?? art.parentId);
        const userBreakdown = Array.from(s.users.entries())
          .map(([charId, count]) => ({ name: narrative.characters[charId]?.name ?? charId, count }))
          .sort((a, b) => b.count - a.count);
        return {
          id,
          name: art.name,
          significance: art.significance as 'key' | 'notable' | 'minor',
          ownerName,
          ownerType,
          usageCount: s.usages,
          uniqueUsers: s.users.size,
          firstIndex: s.first,
          lastIndex: s.last,
          staleness: s.last >= 0 ? totalScenes - 1 - s.last : totalScenes,
          presence: s.presence,
          userBreakdown,
        };
      })
      .filter((s): s is ArtifactStat => s !== null);
  }, [narrative, allScenes]);

  // ── World metrics ──────────────────────────────────────────────────

  const worldMetrics = useMemo((): WorldMetrics | null => {
    if (!narrative || allScenes.length === 0) return null;
    return computeWorldMetrics(narrative, state.resolvedEntryKeys);
  }, [narrative, allScenes, state.resolvedEntryKeys]);

  // ── Sorting ──────────────────────────────────────────────────────────

  const sortedChars = useMemo(() => {
    const sorted = [...characterStats];
    if (sortBy === 'scenes') sorted.sort((a, b) => b.sceneCount - a.sceneCount);
    else if (sortBy === 'staleness') sorted.sort((a, b) => b.staleness - a.staleness);
    else sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [characterStats, sortBy]);

  const sortedLocs = useMemo(() => {
    const sorted = [...locationStats];
    if (sortBy === 'scenes') sorted.sort((a, b) => b.sceneCount - a.sceneCount);
    else if (sortBy === 'staleness') sorted.sort((a, b) => b.staleness - a.staleness);
    else sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [locationStats, sortBy]);

  const sortedArtifacts = useMemo(() => {
    const sorted = [...artifactStats];
    if (sortBy === 'scenes') sorted.sort((a, b) => b.usageCount - a.usageCount);
    else if (sortBy === 'staleness') sorted.sort((a, b) => b.staleness - a.staleness);
    else sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [artifactStats, sortBy]);

  // ── Summary metrics ──────────────────────────────────────────────────

  const castSummary = useMemo(() => {
    if (characterStats.length === 0 || allScenes.length === 0) return null;
    const totalChars = Object.keys(narrative?.characters ?? {}).length;
    const usedChars = characterStats.length;
    const avgScenes = characterStats.reduce((s, c) => s + c.sceneCount, 0) / characterStats.length;
    const staleChars = characterStats.filter((c) => c.staleness > Math.max(5, allScenes.length * 0.3)).length;
    const maxScenes = Math.max(...characterStats.map((c) => c.sceneCount));
    const concentration = maxScenes / allScenes.length;
    return { totalChars, usedChars, avgScenes: avgScenes.toFixed(1), staleChars, concentration: (concentration * 100).toFixed(0) };
  }, [characterStats, allScenes, narrative]);

  const locSummary = useMemo(() => {
    if (locationStats.length === 0 || allScenes.length === 0) return null;
    const totalLocs = Object.keys(narrative?.locations ?? {}).length;
    const usedLocs = locationStats.length;
    const maxScenes = Math.max(...locationStats.map((l) => l.sceneCount));
    const concentration = maxScenes / allScenes.length;
    const staleLocs = locationStats.filter((l) => l.staleness > Math.max(5, allScenes.length * 0.3)).length;
    return { totalLocs, usedLocs, concentration: (concentration * 100).toFixed(0), staleLocs };
  }, [locationStats, allScenes, narrative]);

  const totalScenes = allScenes.length;

  // ── Presence sparkline ───────────────────────────────────────────────

  function Sparkline({ presence, color }: { presence: boolean[]; color: string }) {
    if (presence.length === 0) return null;
    // Bucket into ~40 columns
    const buckets = Math.min(40, presence.length);
    const bucketSize = presence.length / buckets;
    const fills: number[] = [];
    for (let i = 0; i < buckets; i++) {
      const start = Math.floor(i * bucketSize);
      const end = Math.floor((i + 1) * bucketSize);
      let count = 0;
      for (let j = start; j < end; j++) if (presence[j]) count++;
      fills.push(end > start ? count / (end - start) : 0);
    }
    return (
      <div className="flex gap-px h-2.5">
        {fills.map((f, i) => (
          <div
            key={i}
            className="flex-1 rounded-sm"
            style={{ backgroundColor: f > 0 ? color : 'rgba(255,255,255,0.03)', opacity: f > 0 ? 0.25 + f * 0.75 : 1 }}
          />
        ))}
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <Modal onClose={onClose} size="2xl" maxHeight="85vh">
      <ModalHeader onClose={onClose}>
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Usage Analytics</h2>
          <p className="text-[10px] text-text-dim uppercase tracking-wider">{totalScenes} scenes analysed</p>
        </div>
      </ModalHeader>
      <ModalBody className="p-6 space-y-4">
        {/* View tabs */}
        <div className="flex gap-1 bg-bg-elevated rounded-lg p-0.5 shrink-0">
          <button onClick={() => setView('cast')} className={`flex-1 text-[11px] py-1.5 rounded-md transition-colors ${view === 'cast' ? 'bg-white/10 text-text-primary font-semibold' : 'text-text-dim hover:text-text-secondary'}`}>
            Cast
          </button>
          <button onClick={() => setView('locations')} className={`flex-1 text-[11px] py-1.5 rounded-md transition-colors ${view === 'locations' ? 'bg-white/10 text-text-primary font-semibold' : 'text-text-dim hover:text-text-secondary'}`}>
            Locations
          </button>
          <button onClick={() => setView('tools')} className={`flex-1 text-[11px] py-1.5 rounded-md transition-colors ${view === 'tools' ? 'bg-white/10 text-text-primary font-semibold' : 'text-text-dim hover:text-text-secondary'}`}>
            Tools
          </button>
          <button onClick={() => setView('metrics')} className={`flex-1 text-[11px] py-1.5 rounded-md transition-colors ${view === 'metrics' ? 'bg-white/10 text-text-primary font-semibold' : 'text-text-dim hover:text-text-secondary'}`}>
            Expansion
          </button>
        </div>

        {/* Summary strip */}
        {view === 'cast' && castSummary && (
          <div className="flex gap-4 mb-3 text-[10px] text-text-dim">
            <span>{castSummary.usedChars}/{castSummary.totalChars} used</span>
            <span>{castSummary.avgScenes} avg scenes</span>
            <span>{castSummary.staleChars} stale</span>
            <span>Top char: {castSummary.concentration}% of scenes</span>
          </div>
        )}
        {view === 'locations' && locSummary && (
          <div className="flex gap-4 mb-3 text-[10px] text-text-dim">
            <span>{locSummary.usedLocs}/{locSummary.totalLocs} used</span>
            <span>{locSummary.staleLocs} stale</span>
            <span>Top location: {locSummary.concentration}% of scenes</span>
          </div>
        )}
        {view === 'tools' && (() => {
          const totalArtifacts = Object.keys(narrative?.artifacts ?? {}).length;
          const usedArtifacts = artifactStats.filter(a => a.usageCount > 0).length;
          const totalUsages = artifactStats.reduce((s, a) => s + a.usageCount, 0);
          const staleArtifacts = artifactStats.filter(a => a.usageCount === 0).length;
          if (totalArtifacts === 0) return null;
          return (
            <div className="flex gap-4 mb-3 text-[10px] text-text-dim">
              <span>{usedArtifacts}/{totalArtifacts} used</span>
              <span>{totalUsages} total usages</span>
              <span>{staleArtifacts} unused</span>
            </div>
          );
        })()}

        {/* Sort controls */}
        <div className="flex gap-1 mb-3 shrink-0">
          {(['scenes', 'staleness', 'name'] as const).map((s) => (
            <button key={s} onClick={() => setSortBy(s)}
              className={`text-[10px] px-2.5 py-1 rounded-md transition-colors ${sortBy === s ? 'bg-white/10 text-text-primary' : 'text-text-dim hover:text-text-secondary'}`}>
              {s === 'scenes' ? 'By Usage' : s === 'staleness' ? 'By Staleness' : 'By Name'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0 pr-1 space-y-1">
          {view === 'cast' && sortedChars.map((char) => {
            const pct = totalScenes > 0 ? (char.sceneCount / totalScenes) * 100 : 0;
            const staleWarn = char.staleness > Math.max(5, totalScenes * 0.3);
            const color = ROLE_COLORS[char.role] ?? '#6b7280';
            return (
              <div key={char.id} className="rounded-lg border border-white/6 p-2.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-[12px] font-medium text-text-primary flex-1">{char.name}</span>
                  <span className="text-[9px] text-text-dim/50 uppercase">{char.role}</span>
                  {staleWarn && <span className="text-[9px] text-amber-400/70 uppercase">stale</span>}
                </div>
                <Sparkline presence={char.presence} color={color} />
                <div className="flex gap-3 text-[10px] text-text-dim">
                  <span>{char.sceneCount} scene{char.sceneCount !== 1 ? 's' : ''} ({pct.toFixed(0)}%)</span>
                  {char.povCount > 0 && <span>{char.povCount} POV</span>}
                  <span>Last: scene {char.lastIndex + 1}</span>
                  {char.staleness > 0 && <span className={staleWarn ? 'text-amber-400/70' : ''}>{char.staleness} ago</span>}
                </div>
              </div>
            );
          })}

          {view === 'locations' && sortedLocs.map((loc) => {
            const pct = totalScenes > 0 ? (loc.sceneCount / totalScenes) * 100 : 0;
            const staleWarn = loc.staleness > Math.max(5, totalScenes * 0.3);
            const tiedNames = narrative
              ? (narrative.locations[loc.id]?.tiedCharacterIds ?? [])
                  .map((id) => narrative.characters[id]?.name)
                  .filter(Boolean)
              : [];
            return (
              <div key={loc.id} className="rounded-lg border border-white/6 p-2.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-sm bg-amber-500/60 shrink-0" />
                  <span className="text-[12px] font-medium text-text-primary">{loc.name}</span>
                  {loc.parentName && <span className="text-[10px] text-text-dim/50">in {loc.parentName}</span>}
                  <div className="flex-1" />
                  {staleWarn && <span className="text-[9px] text-amber-400/70 uppercase">stale</span>}
                </div>
                <Sparkline presence={loc.presence} color="#f59e0b" />
                <div className="flex gap-3 text-[10px] text-text-dim">
                  <span>{loc.sceneCount} scene{loc.sceneCount !== 1 ? 's' : ''} ({pct.toFixed(0)}%)</span>
                  <span>{loc.uniqueVisitors} visitor{loc.uniqueVisitors !== 1 ? 's' : ''}</span>
                  <span>Last: scene {loc.lastIndex + 1}</span>
                  {loc.staleness > 0 && <span className={staleWarn ? 'text-amber-400/70' : ''}>{loc.staleness} ago</span>}
                </div>
                {tiedNames.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-0.5">
                    {tiedNames.map((name) => (
                      <span key={name} className="text-[9px] text-text-dim bg-white/5 rounded px-1.5 py-0.5">{name}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {view === 'tools' && sortedArtifacts.map((art) => {
            const pct = totalScenes > 0 ? (art.usageCount / totalScenes) * 100 : 0;
            const staleWarn = art.usageCount === 0 || art.staleness > Math.max(5, totalScenes * 0.3);
            const color = SIGNIFICANCE_COLORS[art.significance] ?? '#6b7280';
            const ownerLabel = art.ownerType === 'world' ? 'world' : art.ownerType === 'location' ? `at ${art.ownerName}` : art.ownerName;
            return (
              <div key={art.id} className="rounded-lg border border-white/6 p-2.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-[12px] font-medium text-text-primary flex-1">{art.name}</span>
                  <span className="text-[9px] text-text-dim/50 uppercase">{art.significance}</span>
                  {staleWarn && art.usageCount === 0 && <span className="text-[9px] text-amber-400/70 uppercase">unused</span>}
                  {staleWarn && art.usageCount > 0 && <span className="text-[9px] text-amber-400/70 uppercase">stale</span>}
                </div>
                <Sparkline presence={art.presence} color={color} />
                <div className="flex gap-3 text-[10px] text-text-dim">
                  <span>{art.usageCount} usage{art.usageCount !== 1 ? 's' : ''} ({pct.toFixed(0)}%)</span>
                  {art.uniqueUsers > 0 && <span>{art.uniqueUsers} user{art.uniqueUsers !== 1 ? 's' : ''}</span>}
                  <span className="text-text-dim/50">{art.ownerType === 'world' ? 'world' : art.ownerType === 'location' ? `at ${ownerLabel}` : ownerLabel}</span>
                  {art.lastIndex >= 0 && <span>Last: scene {art.lastIndex + 1}</span>}
                </div>
                {art.userBreakdown.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-0.5">
                    {art.userBreakdown.map(({ name, count }) => (
                      <span key={name} className="text-[9px] text-text-dim bg-white/5 rounded px-1.5 py-0.5">
                        {name} <span className="text-text-dim/50">×{count}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {view === 'metrics' && worldMetrics && (
            <div className="space-y-4">
              {/* Recommendation */}
              <div className={`rounded-lg border p-3.5 ${
                worldMetrics.recommendation === 'depth' ? 'border-blue-500/20 bg-blue-500/5'
                  : worldMetrics.recommendation === 'breadth' ? 'border-amber-500/20 bg-amber-500/5'
                  : 'border-white/10 bg-white/3'
              }`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`text-[12px] font-semibold ${
                    worldMetrics.recommendation === 'depth' ? 'text-blue-400'
                      : worldMetrics.recommendation === 'breadth' ? 'text-amber-400'
                      : 'text-text-primary'
                  }`}>
                    {worldMetrics.recommendation === 'depth' ? 'Deepen' : worldMetrics.recommendation === 'breadth' ? 'Widen' : 'Balanced'}
                  </span>
                  <span className="text-[10px] text-text-dim uppercase">recommended</span>
                </div>
                <p className="text-[11px] text-text-secondary leading-relaxed">{worldMetrics.reasoning}</p>
              </div>

              {/* Cast metrics */}
              <div>
                <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-2">Cast</label>
                <div className="grid grid-cols-2 gap-2">
                  <MetricCard label="Used" value={`${worldMetrics.usedCharacters}/${worldMetrics.totalCharacters}`} />
                  <MetricCard label="Avg scenes/char" value={worldMetrics.avgScenesPerCharacter.toFixed(1)} />
                  <MetricCard label="Stale" value={String(worldMetrics.staleCharacters)} warn={worldMetrics.staleCharacters > worldMetrics.totalCharacters * 0.3} />
                  <MetricCard label="Top char concentration" value={`${(worldMetrics.castConcentration * 100).toFixed(0)}%`} warn={worldMetrics.castConcentration > 0.6} />
                  <MetricCard label="Knowledge density" value={`${worldMetrics.avgKnowledgePerCharacter.toFixed(1)} nodes/char`} warn={worldMetrics.avgKnowledgePerCharacter < 3} />
                  <MetricCard label="Relationships" value={`${worldMetrics.relationshipsPerCharacter.toFixed(1)}/char`} warn={worldMetrics.relationshipsPerCharacter < 2} />
                  <MetricCard label="Orphaned" value={String(worldMetrics.orphanedCharacters)} warn={worldMetrics.orphanedCharacters > 2} />
                </div>
              </div>

              {/* Location metrics */}
              <div>
                <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-2">Locations</label>
                <div className="grid grid-cols-2 gap-2">
                  <MetricCard label="Used" value={`${worldMetrics.usedLocations}/${worldMetrics.totalLocations}`} />
                  <MetricCard label="Top location concentration" value={`${(worldMetrics.locationConcentration * 100).toFixed(0)}%`} warn={worldMetrics.locationConcentration > 0.5} />
                  <MetricCard label="Max depth" value={String(worldMetrics.locationDepth)} warn={worldMetrics.locationDepth <= 2 && worldMetrics.totalLocations > 3} />
                  <MetricCard label="Stale" value={String(worldMetrics.staleLocations)} warn={worldMetrics.staleLocations > worldMetrics.totalLocations * 0.3} />
                  <MetricCard label="Avg children/loc" value={worldMetrics.avgChildrenPerLocation.toFixed(1)} />
                </div>
              </div>
            </div>
          )}

          {totalScenes === 0 && view !== 'metrics' && (
            <p className="text-[11px] text-text-dim/50 italic py-8 text-center">No scenes yet — generate some to see usage analytics.</p>
          )}
        </div>

      </ModalBody>
      <ModalFooter>
        <button onClick={onClose} className="text-[10px] px-3 py-1.5 rounded-md bg-white/5 text-text-dim hover:text-text-secondary transition-colors">
          Close
        </button>
      </ModalFooter>
    </Modal>
  );
}
