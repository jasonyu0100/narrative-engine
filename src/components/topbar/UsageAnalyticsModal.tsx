'use client';

import { useMemo, useState } from 'react';
import { MODEL_PRICING, DEFAULT_PRICING } from '@/lib/constants';
import type { ApiLogEntry } from '@/types/narrative';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getPricing(model?: string) {
  if (!model) return DEFAULT_PRICING;
  return MODEL_PRICING[model] ?? DEFAULT_PRICING;
}

/** Image generation calls use flat per-image pricing, not token pricing */
function isImageGenCall(entry: ApiLogEntry): boolean {
  return entry.model?.startsWith('replicate/') === true || entry.caller.includes('generateImage');
}

/** Flat cost per image for image generation models */
const IMAGE_PRICING: Record<string, number> = {
  'replicate/seedream-4.5': 0.04,
};

function costForEntry(entry: ApiLogEntry): { input: number; output: number; reasoning: number } {
  if (isImageGenCall(entry)) {
    const flatCost = IMAGE_PRICING[entry.model ?? ''] ?? 0.04;
    return { input: 0, output: flatCost, reasoning: 0 };
  }
  const pricing = getPricing(entry.model);
  const inputCost = (entry.promptTokens / 1_000_000) * pricing.input;
  const outputCost = ((entry.responseTokens ?? 0) / 1_000_000) * pricing.output;
  // Reasoning tokens are billed as output tokens
  const reasoningCost = ((entry.reasoningTokens ?? 0) / 1_000_000) * pricing.output;
  return { input: inputCost, output: outputCost, reasoning: reasoningCost };
}

/** Compute total cost for a list of logs */
export function computeTotalCost(logs: ApiLogEntry[]): number {
  let total = 0;
  for (const log of logs) {
    if (log.status !== 'success') continue;
    const c = costForEntry(log);
    total += c.input + c.output + c.reasoning;
  }
  return total;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatCost(v: number): string {
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(4)}`;
}

/** Group entries into per-month buckets for all time */
function bucketByMonth(logs: ApiLogEntry[]): { label: string; shortLabel: string; entries: ApiLogEntry[] }[] {
  const success = logs.filter((l) => l.status === 'success');
  if (success.length === 0) return [];

  const map = new Map<string, ApiLogEntry[]>();
  let minTs = Infinity;
  for (const log of success) {
    const d = new Date(log.timestamp);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(log);
    if (log.timestamp < minTs) minTs = log.timestamp;
  }

  const result: { label: string; shortLabel: string; entries: ApiLogEntry[] }[] = [];
  const cursor = new Date(minTs);
  cursor.setDate(1);
  cursor.setHours(0, 0, 0, 0);
  const now = new Date();
  while (cursor <= now) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
    const shortLabel = `${String(cursor.getMonth() + 1).padStart(2, '0')}/${String(cursor.getFullYear()).slice(2)}`;
    result.push({ label: key, shortLabel, entries: map.get(key) ?? [] });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return result;
}

/** Group entries into per-week buckets for the last 12 weeks */
function bucketByWeek(logs: ApiLogEntry[]): { label: string; shortLabel: string; entries: ApiLogEntry[] }[] {
  const now = new Date();
  now.setHours(23, 59, 59, 999);
  const start = new Date(now);
  start.setDate(start.getDate() - 83); // 12 weeks
  start.setHours(0, 0, 0, 0);
  const windowStart = start.getTime();

  const map = new Map<string, ApiLogEntry[]>();
  for (const log of logs) {
    if (log.status !== 'success' || log.timestamp < windowStart) continue;
    const d = new Date(log.timestamp);
    // Week key: year + ISO week number
    const dayOfWeek = d.getDay() === 0 ? 6 : d.getDay() - 1; // Mon=0
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);
    const key = weekStart.getTime().toString();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(log);
  }

  const result: { label: string; shortLabel: string; entries: ApiLogEntry[] }[] = [];
  const cursor = new Date(start);
  // Align to Monday
  const dayOfWeek = cursor.getDay() === 0 ? 6 : cursor.getDay() - 1;
  cursor.setDate(cursor.getDate() - dayOfWeek);
  cursor.setHours(0, 0, 0, 0);
  while (cursor <= now) {
    const key = cursor.getTime().toString();
    const shortLabel = `${String(cursor.getMonth() + 1).padStart(2, '0')}/${String(cursor.getDate()).padStart(2, '0')}`;
    result.push({ label: key, shortLabel, entries: map.get(key) ?? [] });
    cursor.setDate(cursor.getDate() + 7);
  }
  return result;
}

/** Group entries into per-day buckets for the last 30 days ending now */
function bucketByDay(logs: ApiLogEntry[]): { label: string; shortLabel: string; entries: ApiLogEntry[] }[] {
  const now = new Date();
  now.setHours(23, 59, 59, 999);
  const start = new Date(now);
  start.setDate(start.getDate() - 29);
  start.setHours(0, 0, 0, 0);
  const windowStart = start.getTime();

  const map = new Map<string, ApiLogEntry[]>();
  for (const log of logs) {
    if (log.status !== 'success' || log.timestamp < windowStart) continue;
    const d = new Date(log.timestamp);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(log);
  }

  const result: { label: string; shortLabel: string; entries: ApiLogEntry[] }[] = [];
  const cursor = new Date(start);
  while (cursor <= now) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    result.push({ label: key, shortLabel: key.slice(5), entries: map.get(key) ?? [] });
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

/** Group entries into per-hour buckets for the last 24 hours ending now */
function bucketByHour(logs: ApiLogEntry[]): { label: string; shortLabel: string; entries: ApiLogEntry[] }[] {
  const now = new Date();
  now.setMinutes(59, 59, 999);
  const start = new Date(now);
  start.setHours(start.getHours() - 23);
  start.setMinutes(0, 0, 0);
  const windowStart = start.getTime();

  const map = new Map<string, ApiLogEntry[]>();
  for (const log of logs) {
    if (log.status !== 'success' || log.timestamp < windowStart) continue;
    const d = new Date(log.timestamp);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(log);
  }

  const result: { label: string; shortLabel: string; entries: ApiLogEntry[] }[] = [];
  const cursor = new Date(start);
  while (cursor <= now) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')} ${String(cursor.getHours()).padStart(2, '0')}`;
    const shortLabel = `${String(cursor.getDate()).padStart(2, '0')}/${String(cursor.getHours()).padStart(2, '0')}h`;
    result.push({ label: key, shortLabel, entries: map.get(key) ?? [] });
    cursor.setTime(cursor.getTime() + 3_600_000);
  }
  return result;
}

/** Group entries into per-minute buckets for the last 60 minutes ending now */
function bucketByMinute(logs: ApiLogEntry[]): { label: string; shortLabel: string; entries: ApiLogEntry[] }[] {
  const now = new Date();
  now.setSeconds(59, 999);
  const start = new Date(now);
  start.setMinutes(start.getMinutes() - 59);
  start.setSeconds(0, 0);
  const windowStart = start.getTime();

  const map = new Map<string, ApiLogEntry[]>();
  for (const log of logs) {
    if (log.status !== 'success' || log.timestamp < windowStart) continue;
    const d = new Date(log.timestamp);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(log);
  }

  const result: { label: string; shortLabel: string; entries: ApiLogEntry[] }[] = [];
  const cursor = new Date(start);
  while (cursor <= now) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')} ${String(cursor.getHours()).padStart(2, '0')}:${String(cursor.getMinutes()).padStart(2, '0')}`;
    const shortLabel = `${String(cursor.getHours()).padStart(2, '0')}:${String(cursor.getMinutes()).padStart(2, '0')}`;
    result.push({ label: key, shortLabel, entries: map.get(key) ?? [] });
    cursor.setTime(cursor.getTime() + 60_000);
  }
  return result;
}

/** Compute average tokens/sec for entries in a bucket */
function bucketTokensPerSec(entries: ApiLogEntry[]): number {
  let totalTokens = 0, totalMs = 0;
  for (const e of entries) {
    if (isImageGenCall(e) || !e.durationMs || e.durationMs <= 0) continue;
    totalTokens += (e.responseTokens ?? 0) + (e.reasoningTokens ?? 0);
    totalMs += e.durationMs;
  }
  return totalMs > 0 ? (totalTokens / totalMs) * 1000 : 0;
}

// ── SVG Bar Chart ────────────────────────────────────────────────────────────

type BarDatum = { label: string; shortLabel: string; v1: number; v2: number; v3: number; v4: number };

function BarChart({
  data,
  color1,
  color2,
  color3,
  color4,
  label1,
  label2,
  label3,
  label4,
  formatValue,
  hideCumulative = false,
}: {
  data: BarDatum[];
  color1: string;
  color2: string;
  color3: string;
  color4: string;
  label1: string;
  label2: string;
  label3: string;
  label4: string;
  formatValue: (v: number) => string;
  hideCumulative?: boolean;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const W = 520;
  const H = 140;
  const PAD = { top: 12, right: 40, bottom: 24, left: 48 };
  const cw = W - PAD.left - PAD.right;
  const ch = H - PAD.top - PAD.bottom;

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-20 text-[11px] text-text-dim">
        No data yet
      </div>
    );
  }

  const maxVal = Math.max(...data.map((d) => d.v1 + d.v2 + d.v3 + d.v4), 0.001);
  const barW = Math.max(2, Math.min(20, (cw / data.length) * 0.65));
  const gap = cw / data.length;
  const ticks = Array.from({ length: 4 }, (_, i) => (maxVal / 3) * i);

  return (
    <div className="relative">
      <div className="flex items-center gap-4 mb-1.5 text-[9px] text-text-dim">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm" style={{ background: color1 }} />
          {label1}
        </span>
        {label2 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ background: color2 }} />
            {label2}
          </span>
        )}
        {label3 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ background: color3 }} />
            {label3}
          </span>
        )}
        {label4 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ background: color4 }} />
            {label4}
          </span>
        )}
        {!hideCumulative && (
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 rounded" style={{ background: '#EF4444' }} />
            Cumulative
          </span>
        )}
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
        {ticks.map((v, i) => {
          const y = PAD.top + ch - (v / maxVal) * ch;
          return (
            <g key={i}>
              <line x1={PAD.left} y1={y} x2={PAD.left + cw} y2={y} stroke="white" strokeOpacity="0.04" />
              <text x={PAD.left - 4} y={y + 3} textAnchor="end" fill="white" fillOpacity="0.25" fontSize="7" fontFamily="monospace">
                {formatValue(v)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const x = PAD.left + gap * i + (gap - barW) / 2;
          const h1 = (d.v1 / maxVal) * ch;
          const h2 = (d.v2 / maxVal) * ch;
          const h3 = (d.v3 / maxVal) * ch;
          const h4 = (d.v4 / maxVal) * ch;
          const isH = hovered === i;
          const totalH = h1 + h2 + h3 + h4;
          return (
            <g key={i} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)} className="cursor-pointer">
              <rect x={PAD.left + gap * i} y={PAD.top} width={gap} height={ch} fill="transparent" />
              {h4 > 0 && (
                <rect x={x} y={PAD.top + ch - totalH} width={barW} height={h4} fill={color4} opacity={isH ? 1 : 0.65} rx={1} />
              )}
              {h3 > 0 && (
                <rect x={x} y={PAD.top + ch - h1 - h2 - h3} width={barW} height={h3} fill={color3} opacity={isH ? 1 : 0.65} rx={1} />
              )}
              {h2 > 0 && (
                <rect x={x} y={PAD.top + ch - h1 - h2} width={barW} height={h2} fill={color2} opacity={isH ? 1 : 0.65} rx={1} />
              )}
              <rect x={x} y={PAD.top + ch - h1} width={barW} height={Math.max(h1, 0.5)} fill={color1} opacity={isH ? 1 : 0.65} rx={1} />
              {(data.length <= 16 || i % Math.ceil(data.length / 16) === 0) && (
                <text x={x + barW / 2} y={PAD.top + ch + 12} textAnchor="middle" fill="white" fillOpacity="0.2" fontSize="6.5" fontFamily="monospace">
                  {d.shortLabel}
                </text>
              )}
              {isH && (() => {
                const lines: { label: string; value: string }[] = [{ label: label1, value: formatValue(d.v1) }];
                if (label2 && d.v2 > 0) lines.push({ label: label2, value: formatValue(d.v2) });
                if (label3 && d.v3 > 0) lines.push({ label: label3, value: formatValue(d.v3) });
                if (label4 && d.v4 > 0) lines.push({ label: label4, value: formatValue(d.v4) });
                const tipH = lines.length * 10 + 4;
                const tipX = Math.max(PAD.left, Math.min(x - 36, W - PAD.right - 76));
                const tipY = Math.max(0, PAD.top + ch - totalH - tipH - 6);
                return (
                  <g>
                    <rect x={tipX} y={tipY} width={76} height={tipH} rx={3} fill="#222" stroke="white" strokeOpacity="0.1" />
                    {lines.map((l, li) => (
                      <text key={li} x={tipX + 38} y={tipY + 10 + li * 10} textAnchor="middle" fill="white" fontSize="7" fontFamily="monospace">
                        {l.label}: {l.value}
                      </text>
                    ))}
                  </g>
                );
              })()}
            </g>
          );
        })}
        {/* Cumulative line overlay */}
        {!hideCumulative && data.length > 1 && (() => {
          const cumulative: number[] = [];
          let running = 0;
          for (const d of data) { running += d.v1 + d.v2 + d.v3 + d.v4; cumulative.push(running); }
          const maxCum = Math.max(...cumulative, 0.001);
          const points = cumulative.map((v, i) => {
            const x = PAD.left + gap * i + gap / 2;
            const y = PAD.top + ch - (v / maxCum) * ch;
            return `${x},${y}`;
          });
          const cumTicks = [0, maxCum * 0.5, maxCum].map((v) => ({
            v, y: PAD.top + ch - (v / maxCum) * ch,
          }));
          return (
            <g>
              <polyline points={points.join(' ')} fill="none" stroke="#EF4444" strokeWidth="1.5" strokeLinejoin="round" strokeOpacity="0.7" />
              {cumulative.map((v, i) => {
                const x = PAD.left + gap * i + gap / 2;
                const y = PAD.top + ch - (v / maxCum) * ch;
                return <circle key={i} cx={x} cy={y} r={hovered === i ? 3 : 1.5} fill="#EF4444" opacity={hovered === i ? 1 : 0.6} />;
              })}
              {cumTicks.map((t, i) => (
                <text key={i} x={PAD.left + cw + 4} y={t.y + 3} textAnchor="start" fill="#EF4444" fillOpacity="0.35" fontSize="6" fontFamily="monospace">
                  {formatValue(t.v)}
                </text>
              ))}
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

// ── Dropdown Panel ───────────────────────────────────────────────────────────

export function UsageDropdown({ logs }: { logs: ApiLogEntry[] }) {
  const [view, setView] = useState<'cost' | 'tokens' | 'calls' | 'speed'>('cost');
  const [granularity, setGranularity] = useState<'minute' | 'hour' | 'day' | 'week' | 'month'>('day');

  const successLogs = useMemo(() => logs.filter((l) => l.status === 'success'), [logs]);

  const totals = useMemo(() => {
    let inputTokens = 0, outputTokens = 0, reasoningTokens = 0, inputCost = 0, outputCost = 0, reasoningCost = 0, imageCost = 0, imageCount = 0;
    let speedTokens = 0, speedMs = 0;
    for (const log of successLogs) {
      const c = costForEntry(log);
      if (isImageGenCall(log)) {
        imageCost += c.output;
        imageCount++;
        continue;
      }
      inputTokens += log.promptTokens;
      outputTokens += log.responseTokens ?? 0;
      reasoningTokens += log.reasoningTokens ?? 0;
      inputCost += c.input;
      outputCost += c.output;
      reasoningCost += c.reasoning;
      if (log.durationMs && log.durationMs > 0) {
        speedTokens += (log.responseTokens ?? 0) + (log.reasoningTokens ?? 0);
        speedMs += log.durationMs;
      }
    }
    const avgSpeed = speedMs > 0 ? (speedTokens / speedMs) * 1000 : 0;
    return { inputTokens, outputTokens, reasoningTokens, inputCost, outputCost, reasoningCost, imageCost, imageCount, totalCost: inputCost + outputCost + reasoningCost + imageCost, calls: successLogs.length, avgSpeed };
  }, [successLogs]);

  const modelBreakdown = useMemo(() => {
    const map = new Map<string, { calls: number; inputTokens: number; outputTokens: number; reasoningTokens: number; cost: number }>();
    for (const log of successLogs) {
      if (isImageGenCall(log)) continue;
      const model = log.model ?? 'unknown';
      const existing = map.get(model) ?? { calls: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cost: 0 };
      existing.calls += 1;
      existing.inputTokens += log.promptTokens;
      existing.outputTokens += log.responseTokens ?? 0;
      existing.reasoningTokens += log.reasoningTokens ?? 0;
      const c = costForEntry(log);
      existing.cost += c.input + c.output + c.reasoning;
      map.set(model, existing);
    }
    return [...map.entries()]
      .sort((a, b) => b[1].cost - a[1].cost)
      .map(([model, stats]) => ({ model, ...stats }));
  }, [successLogs]);

  const chartData = useMemo(() => {
    const buckets = granularity === 'minute' ? bucketByMinute(logs) : granularity === 'hour' ? bucketByHour(logs) : granularity === 'week' ? bucketByWeek(logs) : granularity === 'month' ? bucketByMonth(logs) : bucketByDay(logs);
    return buckets.map((b): BarDatum => {
      if (view === 'tokens') {
        let v1 = 0, v2 = 0, v3 = 0;
        for (const e of b.entries) { if (isImageGenCall(e)) continue; v1 += e.promptTokens; v2 += e.responseTokens ?? 0; v3 += e.reasoningTokens ?? 0; }
        return { label: b.label, shortLabel: b.shortLabel, v1, v2, v3, v4: 0 };
      } else if (view === 'cost') {
        let v1 = 0, v2 = 0, v3 = 0, v4 = 0;
        for (const e of b.entries) { const c = costForEntry(e); if (isImageGenCall(e)) { v4 += c.output; } else { v1 += c.input; v2 += c.output; v3 += c.reasoning; } }
        return { label: b.label, shortLabel: b.shortLabel, v1, v2, v3, v4 };
      } else if (view === 'speed') {
        return { label: b.label, shortLabel: b.shortLabel, v1: bucketTokensPerSec(b.entries), v2: 0, v3: 0, v4: 0 };
      } else {
        return { label: b.label, shortLabel: b.shortLabel, v1: b.entries.length, v2: 0, v3: 0, v4: 0 };
      }
    });
  }, [logs, view, granularity]);

  const formatFn = view === 'cost'
    ? formatCost
    : view === 'tokens'
    ? (v: number) => formatTokens(v)
    : view === 'speed'
    ? (v: number) => v >= 1 ? `${Math.round(v)} t/s` : v > 0 ? `${v.toFixed(1)} t/s` : '0'
    : (v: number) => String(Math.round(v));

  return (
    <div className="absolute top-full right-0 mt-1 z-50 bg-bg-base border border-white/10 rounded-lg shadow-2xl p-4 w-[560px] max-h-[80vh] overflow-y-auto">
      {/* Summary row */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        <MiniCard label="Total Cost" value={formatCost(totals.totalCost)} color="#a78bfa" />
        <MiniCard label="Input Tokens" value={formatTokens(totals.inputTokens)} color="#3B82F6" />
        <MiniCard label="Output Tokens" value={formatTokens(totals.outputTokens)} color="#22C55E" />
        <MiniCard label="API Calls" value={String(totals.calls)} color="#facc15" />
        {totals.reasoningTokens > 0 && (
          <MiniCard label="Reasoning" value={formatTokens(totals.reasoningTokens)} color="#c084fc" />
        )}
        {totals.avgSpeed > 0 && (
          <MiniCard label="Avg Speed" value={`${Math.round(totals.avgSpeed)} t/s`} color="#f97316" />
        )}
        {totals.imageCount > 0 && (
          <MiniCard label="Images" value={`${totals.imageCount} (${formatCost(totals.imageCost)})`} color="#f472b6" />
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center rounded border border-white/8 overflow-hidden">
          {(['cost', 'tokens', 'calls', 'speed'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`text-[9px] px-2.5 py-0.5 capitalize transition ${
                view === v ? 'bg-white/10 text-text-primary' : 'text-text-dim hover:text-text-secondary'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="flex items-center rounded border border-white/8 overflow-hidden">
          {(['minute', 'hour', 'day', 'week', 'month'] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGranularity(g)}
              className={`text-[9px] px-2.5 py-0.5 transition ${
                granularity === g ? 'bg-white/10 text-text-primary' : 'text-text-dim hover:text-text-secondary'
              }`}
            >
              {g === 'minute' ? '60m' : g === 'hour' ? '24h' : g === 'day' ? '30d' : g === 'week' ? '12w' : 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <BarChart
        data={chartData}
        color1={view === 'cost' ? '#3B82F6' : view === 'tokens' ? '#3B82F6' : view === 'speed' ? '#f97316' : '#facc15'}
        color2={view === 'cost' ? '#22C55E' : view === 'tokens' ? '#22C55E' : ''}
        color3={view === 'cost' ? '#c084fc' : view === 'tokens' ? '#c084fc' : ''}
        color4={view === 'cost' ? '#f472b6' : ''}
        label1={view === 'cost' ? 'Input' : view === 'tokens' ? 'Input' : view === 'speed' ? 'Tokens/sec' : 'Calls'}
        label2={view === 'cost' ? 'Output' : view === 'tokens' ? 'Output' : ''}
        label3={view === 'cost' ? 'Reasoning' : view === 'tokens' ? 'Reasoning' : ''}
        label4={view === 'cost' ? 'Images' : ''}
        formatValue={formatFn}
        hideCumulative={view === 'speed'}
      />

      {/* Model breakdown */}
      {modelBreakdown.length > 0 && (
        <div className="mt-4">
          <h3 className="text-[9px] text-text-dim uppercase tracking-wider mb-1.5">By Model</h3>
          <div className="border border-white/6 rounded overflow-hidden">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-text-dim text-left border-b border-white/5">
                  <th className="px-2.5 py-1.5 font-medium">Model</th>
                  <th className="px-2.5 py-1.5 font-medium text-right">Calls</th>
                  <th className="px-2.5 py-1.5 font-medium text-right">Input</th>
                  <th className="px-2.5 py-1.5 font-medium text-right">Output</th>
                  <th className="px-2.5 py-1.5 font-medium text-right">Reasoning</th>
                  <th className="px-2.5 py-1.5 font-medium text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {modelBreakdown.map((m) => (
                  <tr key={m.model} className="border-b border-white/3 hover:bg-white/3 transition-colors">
                    <td className="px-2.5 py-1.5 text-text-secondary font-mono">{m.model.split('/').pop()}</td>
                    <td className="px-2.5 py-1.5 text-right text-text-dim">{m.calls}</td>
                    <td className="px-2.5 py-1.5 text-right text-text-dim">{formatTokens(m.inputTokens)}</td>
                    <td className="px-2.5 py-1.5 text-right text-text-dim">{formatTokens(m.outputTokens)}</td>
                    <td className="px-2.5 py-1.5 text-right text-text-dim">{formatTokens(m.reasoningTokens)}</td>
                    <td className="px-2.5 py-1.5 text-right text-text-primary font-mono">{formatCost(m.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pricing footnote */}
      <div className="mt-3 flex items-center gap-3 text-[8px] text-text-dim">
        {Object.entries(MODEL_PRICING).map(([model, p]) => (
          <span key={model} className="font-mono">
            {model.split('/').pop()}: ${p.input}/{p.output}/M
          </span>
        ))}
      </div>
    </div>
  );
}

function MiniCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded border border-white/6 px-2.5 py-2" style={{ background: `${color}06` }}>
      <div className="text-[8px] text-text-dim uppercase tracking-wider mb-0.5">{label}</div>
      <div className="text-[14px] font-semibold font-mono leading-tight" style={{ color }}>{value}</div>
    </div>
  );
}
