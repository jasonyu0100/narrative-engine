'use client';

import { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';

export type ChartStyle = {
  showArea: boolean;
  showWindow: boolean;
  showMovingAvg: boolean;
  curve: 'smooth' | 'linear' | 'step';
};

type ForceLineChartProps = {
  data: number[];
  color: string;
  label: string;
  currentIndex: number;
  /** Inclusive data-index range for the active normalization window */
  windowStart?: number;
  windowEnd?: number;
  /** If true, domain starts at 0 (for always-positive values like balance magnitude) */
  positive?: boolean;
  style?: ChartStyle;
  /** Optional moving average overlay data (same length as data) */
  movingAvg?: number[];
};

const CURVE_FNS = {
  smooth: d3.curveMonotoneX,
  linear: d3.curveLinear,
  step: d3.curveStepAfter,
};

export default function ForceLineChart({
  data,
  color,
  label,
  currentIndex,
  windowStart,
  windowEnd,
  positive,
  style,
  movingAvg,
}: ForceLineChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 200, height: 60 });

  const showArea = style?.showArea ?? true;
  const showWindow = style?.showWindow ?? true;
  const showMovingAvg = style?.showMovingAvg ?? true;
  const curveFn = CURVE_FNS[style?.curve ?? 'smooth'];

  // Observe container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDims({ width, height });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // D3 rendering
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    if (data.length === 0) return;

    const { width, height } = dims;
    const chartTop = 0;
    const chartHeight = height;

    const xScale = d3
      .scaleLinear()
      .domain([0, Math.max(data.length - 1, 1)])
      .range([0, width]);

    const maxAbs = data.reduce((m, v) => Math.max(m, Math.abs(v)), 1);
    const yScale = d3
      .scaleLinear()
      .domain(positive ? [0, maxAbs * 1.1] : [-maxAbs, maxAbs])
      .range([chartHeight, chartTop]);

    // Zero line at y=0
    const zeroY = yScale(0);
    svg
      .append('line')
      .attr('x1', 0)
      .attr('x2', width)
      .attr('y1', zeroY)
      .attr('y2', zeroY)
      .attr('stroke', '#FFFFFF')
      .attr('stroke-width', 0.5)
      .attr('opacity', 0.12);

    // Window highlight region
    if (showWindow && windowStart != null && windowEnd != null && data.length > 1) {
      const wx1 = xScale(windowStart);
      const wx2 = xScale(windowEnd);
      svg
        .append('rect')
        .attr('x', wx1)
        .attr('y', chartTop)
        .attr('width', Math.max(wx2 - wx1, 1))
        .attr('height', chartHeight)
        .attr('fill', color)
        .attr('opacity', 0.06);
      // Left edge
      svg
        .append('line')
        .attr('x1', wx1)
        .attr('x2', wx1)
        .attr('y1', chartTop)
        .attr('y2', chartHeight)
        .attr('stroke', color)
        .attr('stroke-width', 0.5)
        .attr('opacity', 0.3);
    }

    // Area (filled from zero line)
    if (showArea) {
      const area = d3
        .area<number>()
        .x((_, i) => xScale(i))
        .y0(zeroY)
        .y1((d) => yScale(d))
        .curve(curveFn);

      svg
        .append('path')
        .datum(data)
        .attr('d', area)
        .attr('fill', color)
        .attr('opacity', 0.1);
    }

    // Line
    const line = d3
      .line<number>()
      .x((_, i) => xScale(i))
      .y((d) => yScale(d))
      .curve(curveFn);

    svg
      .append('path')
      .datum(data)
      .attr('d', line)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 1.5)
      .attr('opacity', 0.8);

    // Moving average overlay
    if (showMovingAvg && movingAvg && movingAvg.length === data.length) {
      const maLine = d3
        .line<number>()
        .x((_, i) => xScale(i))
        .y((d) => yScale(d))
        .curve(d3.curveMonotoneX);

      svg
        .append('path')
        .datum(movingAvg)
        .attr('d', maLine)
        .attr('fill', 'none')
        .attr('stroke', '#FFFFFF')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '3,2')
        .attr('opacity', 0.4);
    }

    // Current scene cursor
    if (currentIndex >= 0 && currentIndex < data.length) {
      const cx = xScale(currentIndex);
      svg
        .append('line')
        .attr('x1', cx)
        .attr('x2', cx)
        .attr('y1', chartTop)
        .attr('y2', chartHeight)
        .attr('stroke', '#FFFFFF')
        .attr('stroke-width', 1)
        .attr('opacity', 0.2);
    }
  }, [data, color, currentIndex, dims, windowStart, windowEnd, positive, showArea, showWindow, showMovingAvg, curveFn, movingAvg]);

  const currentValue =
    currentIndex >= 0 && currentIndex < data.length
      ? data[currentIndex]
      : undefined;

  return (
    <div className="flex-1 flex flex-col px-2 py-1.5 min-w-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-baseline justify-between mb-0.5">
        <span className="text-[9px] uppercase tracking-wider text-text-dim">
          {label}
        </span>
        {currentValue !== undefined && (
          <span className="text-[9px] font-medium" style={{ color }}>
            {currentValue.toFixed(2)}
          </span>
        )}
      </div>
      {/* Chart */}
      <div ref={containerRef} className="flex-1 min-h-0">
        <svg
          ref={svgRef}
          width={dims.width}
          height={dims.height}
          className="block"
          preserveAspectRatio="none"
        />
      </div>
    </div>
  );
}
