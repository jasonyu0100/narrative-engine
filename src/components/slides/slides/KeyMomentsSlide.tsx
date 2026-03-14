'use client';

import React from 'react';
import type { SlidesData } from '@/lib/slides-data';

const FORCE_COLORS: Record<string, string> = {
  payoff: '#EF4444',
  change: '#22C55E',
  knowledge: '#3B82F6',
};

function ForceBar({ force, value, maxForce }: { force: string; value: number; maxForce: number }) {
  const pct = Math.abs(value) / maxForce;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-medium w-12 capitalize" style={{ color: FORCE_COLORS[force] }}>{force}</span>
      <div className="flex-1 h-2.5 rounded-full bg-white/5 overflow-hidden relative">
        <div className="absolute left-1/2 top-0 w-px h-full bg-white/8" />
        <div
          className="absolute h-full rounded-full"
          style={{
            ...(value >= 0 ? { left: '50%' } : { right: '50%' }),
            width: `${pct * 50}%`,
            backgroundColor: FORCE_COLORS[force],
            opacity: 0.7,
          }}
        />
      </div>
      <span className="text-[10px] font-mono text-text-secondary w-10 text-right">
        {value >= 0 ? '+' : ''}{value.toFixed(1)}
      </span>
    </div>
  );
}

export function KeyMomentsSlide({ data, sceneIdx, kind }: { data: SlidesData; sceneIdx: number; kind: 'peak' | 'valley' }) {
  const isPeak = kind === 'peak';

  // Find the matching peak or trough info
  const peakInfo = isPeak ? data.peaks.find((p) => p.sceneIdx === sceneIdx) : null;
  const troughInfo = !isPeak ? data.troughs.find((t) => t.sceneIdx === sceneIdx) : null;

  const scene = data.scenes[sceneIdx];
  if (!scene) return null;

  const forces = peakInfo?.forces ?? troughInfo?.forces ?? { payoff: 0, change: 0, knowledge: 0 };
  const engagement = peakInfo?.engagement ?? troughInfo?.engagement;
  const cubeCorner = peakInfo?.cubeCorner ?? troughInfo?.cubeCorner;
  const threadChanges = peakInfo?.threadChanges ?? scene.threadMutations?.map((tm) => ({ threadId: tm.threadId, from: tm.from, to: tm.to })) ?? [];
  const relationshipChanges = peakInfo?.relationshipChanges ?? scene.relationshipMutations?.map((rm) => ({ from: rm.from, to: rm.to, type: rm.type, delta: rm.valenceDelta })) ?? [];

  const maxForce = Math.max(Math.abs(forces.payoff), Math.abs(forces.change), Math.abs(forces.knowledge), 0.5);
  const povName = data.characterNames[scene.povId] ?? scene.povId;
  const locationName = data.locationNames[scene.locationId] ?? scene.locationId;
  const participants = scene.participantIds
    .filter((id) => id !== scene.povId)
    .map((id) => data.characterNames[id] ?? id);

  const knowledgeGains = scene.continuityMutations?.filter((km) => km.action === 'added') ?? [];

  return (
    <div className="flex flex-col h-full px-12 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <div className={`w-3 h-3 rounded-full ${isPeak ? 'bg-amber-400' : 'bg-blue-400'}`} />
        <h2 className={`text-2xl font-bold ${isPeak ? 'text-amber-400' : 'text-blue-300'}`}>
          {isPeak ? 'Peak' : 'Valley'}
        </h2>
        <span className="text-sm text-text-dim font-mono">Scene {sceneIdx + 1}</span>
        {cubeCorner && (
          <span className="text-[10px] px-2.5 py-1 rounded-lg border border-white/10 bg-white/3 text-text-dim">
            {cubeCorner.name}
          </span>
        )}
        {engagement && (
          <span className="ml-auto text-sm font-mono text-text-dim">
            Engagement <span className={`font-bold ${isPeak ? 'text-amber-400' : 'text-blue-300'}`}>{engagement.engagement.toFixed(2)}</span>
          </span>
        )}
      </div>
      {cubeCorner && (
        <p className="text-[11px] text-text-dim mb-5">{cubeCorner.description}</p>
      )}

      {/* Main grid */}
      <div className="flex-1 grid grid-cols-5 gap-8 min-h-0">
        {/* Col 1-2: Scene details */}
        <div className="col-span-2 flex flex-col gap-5">
          {/* POV & Location */}
          <div>
            <div className="text-[9px] uppercase tracking-widest text-text-dim mb-2">Scene</div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-white/8 flex items-center justify-center text-xs font-bold text-text-primary">
                {povName.charAt(0)}
              </div>
              <div>
                <div className="text-sm text-text-primary font-medium">{povName}</div>
                <div className="text-[10px] text-emerald-400/70">{locationName}</div>
              </div>
            </div>
            {participants.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {participants.slice(0, 6).map((name) => (
                  <span key={name} className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-text-dim">{name}</span>
                ))}
                {participants.length > 6 && (
                  <span className="text-[10px] px-2 py-0.5 text-text-dim">+{participants.length - 6}</span>
                )}
              </div>
            )}
          </div>

          {/* Summary */}
          <div className={`px-4 py-3 rounded-lg border ${isPeak ? 'border-amber-400/15 bg-amber-400/2' : 'border-blue-400/15 bg-blue-400/2'}`}>
            <p className="text-[12px] text-text-secondary leading-relaxed">{scene.summary}</p>
          </div>

          {/* Events */}
          {scene.events.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-widest text-text-dim mb-1.5">Events</div>
              <div className="flex flex-wrap gap-1.5">
                {scene.events.map((ev, i) => (
                  <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-text-secondary font-mono">{ev}</span>
                ))}
              </div>
            </div>
          )}

          {/* Knowledge gains */}
          {knowledgeGains.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-widest text-text-dim mb-1.5">Knowledge Gained</div>
              <div className="space-y-1">
                {knowledgeGains.slice(0, 4).map((km, i) => (
                  <div key={i} className="text-[10px] flex gap-2">
                    <span className="text-text-primary font-medium shrink-0">{data.characterNames[km.characterId] ?? km.characterId}</span>
                    <span className="text-text-dim truncate">{km.content}</span>
                  </div>
                ))}
                {knowledgeGains.length > 4 && (
                  <span className="text-[9px] text-text-dim">+{knowledgeGains.length - 4} more</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Col 3: Forces */}
        <div className="col-span-1 flex flex-col gap-5">
          <div>
            <div className="text-[9px] uppercase tracking-widest text-text-dim mb-2">Forces</div>
            <div className="space-y-2">
              <ForceBar force="payoff" value={forces.payoff} maxForce={maxForce} />
              <ForceBar force="change" value={forces.change} maxForce={maxForce} />
              <ForceBar force="knowledge" value={forces.knowledge} maxForce={maxForce} />
            </div>
          </div>

          {engagement && (
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-text-dim">Tension</span>
                <span className="font-mono text-text-secondary">{engagement.tension.toFixed(2)}</span>
              </div>
              {engagement.isPeak && (
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-text-dim">Local max</span>
                  <span className="text-amber-400 font-mono">yes</span>
                </div>
              )}
              {engagement.isValley && (
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-text-dim">Local min</span>
                  <span className="text-blue-300 font-mono">yes</span>
                </div>
              )}
            </div>
          )}

          {/* Valley recovery info */}
          {troughInfo && (
            <div className="pt-2 space-y-2 border-t border-white/6">
              <div className="text-[9px] uppercase tracking-widest text-text-dim mb-1">Recovery</div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-text-dim">Next peak in</span>
                <span className="font-mono text-text-secondary">{troughInfo.scenesToNextPeak} scenes</span>
              </div>
              {troughInfo.recoveryForce && (
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-text-dim">Driver</span>
                  <span className="font-medium capitalize" style={{ color: FORCE_COLORS[troughInfo.recoveryForce] }}>{troughInfo.recoveryForce}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Col 4-5: Mutations */}
        <div className="col-span-2 flex flex-col gap-5">
          {/* Thread mutations */}
          {threadChanges.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-widest text-text-dim mb-2">
                Thread Mutations ({threadChanges.length})
              </div>
              <div className="space-y-1.5">
                {threadChanges.slice(0, 6).map((tc, i) => {
                  const desc = data.threadDescriptions[tc.threadId];
                  const label = desc ? (desc.length > 50 ? desc.slice(0, 50) + '\u2026' : desc) : tc.threadId;
                  return (
                    <div key={i} className="flex items-center gap-2 text-[10px] px-3 py-1.5 rounded-lg bg-white/3 border border-white/5">
                      <span className="text-text-secondary flex-1 truncate" title={desc}>{label}</span>
                      <span className="text-text-dim shrink-0">{tc.from}</span>
                      <span className={`shrink-0 ${isPeak ? 'text-amber-400' : 'text-blue-300'}`}>&rarr;</span>
                      <span className="text-text-primary font-medium shrink-0">{tc.to}</span>
                    </div>
                  );
                })}
                {threadChanges.length > 6 && (
                  <span className="text-[9px] text-text-dim">+{threadChanges.length - 6} more</span>
                )}
              </div>
            </div>
          )}

          {/* Relationship mutations */}
          {relationshipChanges.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-widest text-text-dim mb-2">
                Relationship Shifts ({relationshipChanges.length})
              </div>
              <div className="space-y-1.5">
                {relationshipChanges.slice(0, 5).map((rc, i) => {
                  const fromName = data.characterNames[rc.from] ?? rc.from;
                  const toName = data.characterNames[rc.to] ?? rc.to;
                  return (
                    <div key={i} className="flex items-center gap-2 text-[10px] px-3 py-1.5 rounded-lg bg-white/3 border border-white/5">
                      <span className="text-text-secondary">{fromName}</span>
                      <span className="text-text-dim">&harr;</span>
                      <span className="text-text-secondary">{toName}</span>
                      <span className="text-text-dim flex-1 truncate ml-1">{rc.type}</span>
                      <span className="ml-auto font-mono shrink-0" style={{ color: rc.delta > 0 ? '#22C55E' : '#EF4444' }}>
                        {rc.delta > 0 ? '+' : ''}{rc.delta.toFixed(1)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {threadChanges.length === 0 && relationshipChanges.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <p className="text-[11px] text-text-dim italic">No mutations in this scene</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
