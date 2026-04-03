'use client';

import type { SlidesData } from '@/lib/slides-data';
import { flattenFnMechDist } from '@/lib/mechanism-profiles';

const MECH_COLORS: Record<string, string> = {
  dialogue: '#3b82f6',
  thought: '#a855f7',
  action: '#22c55e',
  environment: '#06b6d4',
  narration: '#f59e0b',
  memory: '#ec4899',
  document: '#84cc16',
  comic: '#ef4444',
};

const MECH_DESCRIPTIONS: Record<string, string> = {
  dialogue: 'Conversation with subtext — characters speak, revealing intent through word choice and rhythm',
  thought: 'Internal monologue — the POV character\'s private reasoning and emotional response',
  action: 'Physical movement — gesture, interaction with objects, bodies in space',
  environment: 'Setting as character — weather, lighting, sensory details that carry meaning',
  narration: 'Authorial voice — commentary, rhetorical structures, the narrator\'s presence',
  memory: 'Flashback — past surfaces through association, adding depth to present moments',
  document: 'Embedded text — letters, newspapers, signs, excerpts that expand the world',
  comic: 'Humor and irony — absurdity, bathos, the unexpected that reframes tension',
};

export function MechanismSlide({ data }: { data: SlidesData }) {
  const mechDist = data.beatSampler?.fnMechanismDistribution
    ? flattenFnMechDist(data.beatSampler.fnMechanismDistribution)
    : {};
  const sortedMechs = Object.entries(mechDist)
    .filter(([, v]) => v && v > 0)
    .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0));

  const maxPct = sortedMechs.length > 0 ? (sortedMechs[0][1] ?? 0) : 0;

  // Calculate dominant mechanism
  const dominant = sortedMechs.length > 0 ? sortedMechs[0][0] : null;

  // Calculate variety score (how evenly distributed mechanisms are)
  const total = sortedMechs.reduce((s, [, v]) => s + (v ?? 0), 0);
  const entropy = total > 0
    ? -sortedMechs.reduce((s, [, v]) => {
        const p = (v ?? 0) / total;
        return s + (p > 0.001 ? p * Math.log2(p) : 0);
      }, 0)
    : 0;
  const maxEntropy = Math.log2(8); // 8 mechanisms
  const varietyScore = entropy / maxEntropy;

  if (sortedMechs.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center px-10 py-6">
        <p className="text-text-dim text-sm">No mechanism data available.</p>
        <p className="text-[11px] text-text-dim mt-1">Generate scene plans to see delivery mechanism analytics.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col justify-center h-full px-12 py-8">
      <h2 className="text-2xl font-bold text-text-primary mb-1">Mechanisms of Delivery</h2>
      <p className="text-sm text-text-secondary mb-8">
        How beats are rendered as prose — the delivery techniques that shape the reading experience.
      </p>

      <div className="flex items-center gap-12">
        {/* Horizontal bar chart */}
        <div className="flex-1 space-y-3">
          {sortedMechs.map(([mech, pct]) => {
            const width = maxPct > 0 ? ((pct ?? 0) / maxPct) * 100 : 0;
            const percentage = Math.round((pct ?? 0) * 100);
            return (
              <div key={mech} className="group">
                <div className="flex items-center gap-3 mb-1">
                  <span
                    className="text-sm font-medium w-24 capitalize"
                    style={{ color: MECH_COLORS[mech] || '#888' }}
                  >
                    {mech}
                  </span>
                  <div className="flex-1 h-5 rounded bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded transition-all duration-500"
                      style={{
                        width: `${width}%`,
                        backgroundColor: MECH_COLORS[mech] || '#888',
                        opacity: 0.7,
                      }}
                    />
                  </div>
                  <span className="text-sm font-mono text-text-primary w-12 text-right">
                    {percentage}%
                  </span>
                </div>
                <p className="text-[10px] text-text-dim ml-27 opacity-0 group-hover:opacity-100 transition-opacity">
                  {MECH_DESCRIPTIONS[mech] || ''}
                </p>
              </div>
            );
          })}
        </div>

        {/* Stats panel */}
        <div className="w-56 space-y-4 shrink-0">
          {/* Dominant mechanism */}
          {dominant && (
            <div className="px-4 py-3 rounded-lg border border-white/8 bg-white/[0.02]">
              <p className="text-[10px] text-text-dim uppercase tracking-wider mb-1">Primary Mechanism</p>
              <p className="text-lg font-semibold capitalize" style={{ color: MECH_COLORS[dominant] }}>
                {dominant}
              </p>
              <p className="text-[10px] text-text-dim mt-1 leading-relaxed">
                {MECH_DESCRIPTIONS[dominant]}
              </p>
            </div>
          )}

          {/* Variety */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-text-dim uppercase tracking-wider">Variety</span>
              <span className="text-xs font-mono text-text-primary">{(varietyScore * 100).toFixed(0)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full rounded-full bg-violet-400"
                style={{ width: `${varietyScore * 100}%` }}
              />
            </div>
            <p className="text-[9px] text-text-dim mt-1">
              {varietyScore > 0.8
                ? 'Balanced use of all mechanisms.'
                : varietyScore > 0.5
                  ? 'Moderate variety — some mechanisms dominate.'
                  : 'Low variety — consider diversifying delivery.'}
            </p>
          </div>

          {/* Mechanism count */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-dim">Mechanisms used</span>
            <span className="text-text-primary font-mono">{sortedMechs.length}/8</span>
          </div>
        </div>
      </div>
    </div>
  );
}
