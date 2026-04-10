/** Reusable cube corner visualization badge — three colored bars for P/C/K forces */

import type { CubeCornerKey } from '@/types/narrative';

type Props = {
  cornerKey: CubeCornerKey;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showLabels?: boolean;
};

const SIZES = {
  xs: { width: 18, height: 10, barWidth: 5, spacing: 7, rx: 0.75 },
  sm: { width: 21, height: 12, barWidth: 6, spacing: 8, rx: 1 },
  md: { width: 24, height: 12, barWidth: 7, spacing: 9, rx: 1 },
  lg: { width: 30, height: 14, barWidth: 8, spacing: 11, rx: 1 },
};

const FORCE_COLORS = ['#EF4444', '#22C55E', '#3B82F6']; // Drive, World, System
const FORCE_LABELS = ['P', 'W', 'S'];

export function CubeCornerBadge({ cornerKey, size = 'md', showLabels = false }: Props) {
  const { width, height, barWidth, spacing, rx } = SIZES[size];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="inline-block shrink-0">
      {cornerKey.split('').map((level, i) => {
        const isHigh = level === 'H';
        const barHeight = isHigh ? height * 0.75 : height * 0.35;
        const y = height - barHeight;
        const opacity = isHigh ? 0.9 : 0.35;

        return (
          <g key={i}>
            <rect
              x={i * spacing}
              y={y}
              width={barWidth}
              height={barHeight}
              rx={rx}
              fill={FORCE_COLORS[i]}
              opacity={opacity}
            />
            {showLabels && (
              <text
                x={i * spacing + barWidth / 2}
                y={height + 8}
                fill="currentColor"
                fontSize="8"
                fontWeight="600"
                textAnchor="middle"
                className="text-text-dim"
              >
                {FORCE_LABELS[i]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
