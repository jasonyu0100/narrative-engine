'use client';

import { useStore } from '@/lib/store';
import { resolveProfile, BEAT_PROFILE_PRESETS } from '@/lib/beat-profiles';
import { BEAT_FN_LIST, BEAT_MECHANISM_LIST } from '@/types/narrative';
import type { BeatFn, ProseProfile } from '@/types/narrative';

type Props = { onClose: () => void };

const FN_COLORS: Record<string, string> = {
  breathe: '#6b7280', inform: '#3b82f6', advance: '#22c55e', bond: '#ec4899',
  turn: '#f59e0b', reveal: '#a855f7', shift: '#ef4444', expand: '#06b6d4',
  foreshadow: '#84cc16', resolve: '#14b8a6',
};

const MECH_COLORS: Record<string, string> = {
  dialogue: '#3b82f6', thought: '#a855f7', action: '#22c55e', environment: '#06b6d4',
  narration: '#f59e0b', memory: '#ec4899', document: '#84cc16', comic: '#ef4444',
};

function MiniMatrix({ profile }: { profile: ProseProfile }) {
  const fns = BEAT_FN_LIST.filter((fn) => (profile.beatDistribution ?? {})[fn]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[9px] border-collapse">
        <thead>
          <tr>
            <th className="p-1 text-left text-text-dim font-medium w-16">From ↓ To →</th>
            {fns.map((fn) => (
              <th key={fn} className="p-1 text-center font-medium" style={{ color: FN_COLORS[fn] }}>
                {fn.slice(0, 4)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {fns.map((from) => {
            const row = (profile.markov ?? {})[from as keyof typeof profile.markov] ?? {};
            return (
              <tr key={from} className="border-t border-white/5">
                <td className="p-1 font-medium" style={{ color: FN_COLORS[from] }}>{from.slice(0, 4)}</td>
                {fns.map((to) => {
                  const prob = row[to as BeatFn] ?? 0;
                  const intensity = Math.round(prob * 100);
                  return (
                    <td
                      key={to}
                      className="p-1 text-center tabular-nums"
                      style={{
                        backgroundColor: prob > 0 ? `rgba(52, 211, 153, ${Math.min(intensity / 80, 1)})` : 'transparent',
                        color: prob >= 0.25 ? '#fff' : prob > 0.05 ? '#d1d5db' : '#4b5563',
                      }}
                    >
                      {prob > 0 ? intensity : '·'}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ProseProfilePanel({ onClose }: Props) {
  const { state } = useStore();
  const narrative = state.activeNarrative;

  if (!narrative) return null;

  const profile = resolveProfile(narrative);
  const presetName = narrative.storySettings?.beatProfilePreset
    ? BEAT_PROFILE_PRESETS.find((p) => p.key === narrative.storySettings?.beatProfilePreset)?.name ?? profile.name
    : profile.name;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="text-[13px] font-semibold text-text-primary">Prose Profile</h2>
          <p className="text-[10px] text-text-dim">{presetName} — {profile.scenesAnalyzed} scenes analysed</p>
        </div>
        <button onClick={onClose} className="text-text-dim hover:text-text-primary text-lg transition-colors">&times;</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Voice */}
        <div>
          <span className="text-[9px] uppercase tracking-widest text-text-dim block mb-2">Voice</span>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="px-2.5 py-2 rounded border border-white/5 bg-white/2">
              <span className="text-[9px] text-text-dim block">Register</span>
              <span className="text-text-primary font-medium capitalize">{profile.register ?? 'conversational'}</span>
            </div>
            <div className="px-2.5 py-2 rounded border border-white/5 bg-white/2">
              <span className="text-[9px] text-text-dim block">Stance</span>
              <span className="text-text-primary font-medium">{(profile.stance ?? 'close_third').replace(/_/g, ' ')}</span>
            </div>
          </div>
        </div>

        {/* Devices */}
        <div>
          <span className="text-[9px] uppercase tracking-widest text-text-dim block mb-2">Devices</span>
          <div className="flex flex-wrap gap-1.5">
            {(profile.devices ?? []).map((d) => (
              <span key={d} className="text-[10px] px-2 py-1 rounded-full border border-white/10 text-text-secondary">
                {d.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>

        {/* Rules */}
        {(profile.rules?.length ?? 0) > 0 && (
          <div>
            <span className="text-[9px] uppercase tracking-widest text-text-dim block mb-2">Rules</span>
            <div className="space-y-1.5">
              {(profile.rules ?? []).map((r, i) => (
                <p key={i} className="text-[10px] text-text-secondary leading-snug pl-3 border-l border-white/10">
                  {r}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Beat Distribution */}
        <div>
          <span className="text-[9px] uppercase tracking-widest text-text-dim block mb-2">Beat Distribution</span>
          <div className="space-y-1">
            {Object.entries(profile.beatDistribution ?? {})
              .filter(([, v]) => v && v > 0)
              .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
              .map(([fn, pct]) => (
                <div key={fn} className="flex items-center gap-2">
                  <span className="text-[9px] font-mono w-16 shrink-0" style={{ color: FN_COLORS[fn] }}>{fn}</span>
                  <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(pct ?? 0) * 100}%`, backgroundColor: FN_COLORS[fn], opacity: 0.7 }} />
                  </div>
                  <span className="text-[9px] text-text-dim font-mono w-8 text-right">{Math.round((pct ?? 0) * 100)}%</span>
                </div>
              ))}
          </div>
        </div>

        {/* Mechanism Distribution */}
        <div>
          <span className="text-[9px] uppercase tracking-widest text-text-dim block mb-2">Mechanism Distribution</span>
          <div className="space-y-1">
            {Object.entries(profile.mechanismDistribution ?? {})
              .filter(([, v]) => v && v > 0)
              .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
              .map(([mech, pct]) => (
                <div key={mech} className="flex items-center gap-2">
                  <span className="text-[9px] font-mono w-16 shrink-0" style={{ color: MECH_COLORS[mech] }}>{mech}</span>
                  <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(pct ?? 0) * 100}%`, backgroundColor: MECH_COLORS[mech], opacity: 0.7 }} />
                  </div>
                  <span className="text-[9px] text-text-dim font-mono w-8 text-right">{Math.round((pct ?? 0) * 100)}%</span>
                </div>
              ))}
          </div>
        </div>

        {/* Beat Transition Matrix */}
        <div>
          <span className="text-[9px] uppercase tracking-widest text-text-dim block mb-2">Beat Transition Matrix</span>
          <p className="text-[9px] text-text-dim/50 mb-2">Probability of transitioning from one beat function to another. Read: row → column.</p>
          <MiniMatrix profile={profile} />
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 text-[9px] text-text-dim pt-2 border-t border-white/5">
          <span>{profile.totalBeats} total beats</span>
          <span>{profile.beatsPerKWord} beats/kword</span>
          <span>{profile.scenesAnalyzed} scenes</span>
        </div>
      </div>
    </div>
  );
}
