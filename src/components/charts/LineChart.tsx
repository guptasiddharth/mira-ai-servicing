"use client";

import { useMemo, useRef, useState } from "react";

/**
 * Lightweight SVG line chart: 2px lines, recessive hairline grid, legend for
 * ≥2 series, end-point markers with direct labels, crosshair + tooltip hover.
 */

export interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
  /** Short label drawn at the series' final point. */
  endLabel?: string;
}

function niceStep(max: number, ticks = 4) {
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

export function LineChart({
  series,
  height = 190,
  formatY,
  formatX,
  minY,
  step = false,
  ariaLabel,
}: {
  series: Series[];
  height?: number;
  formatY: (v: number) => string;
  formatX: (i: number) => string;
  minY?: number;
  step?: boolean;
  ariaLabel: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 560;
  const H = height;
  const pad = { l: 46, r: 16, t: 14, b: 24 };
  const n = Math.max(...series.map((s) => s.values.length));
  const maxV = Math.max(...series.flatMap((s) => s.values));
  const lo = minY ?? 0;
  const stepY = niceStep(maxV - lo);
  const hi = Math.ceil(maxV / stepY) * stepY;
  const yTicks = useMemo(() => {
    const t: number[] = [];
    for (let v = Math.ceil(lo / stepY) * stepY; v <= hi + 1e-6; v += stepY) t.push(v);
    return t;
  }, [lo, hi, stepY]);

  const x = (i: number) => pad.l + (i / Math.max(1, n - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
  const path = (vals: number[]) =>
    vals
      .map((v, i) => {
        if (i === 0) return `M${x(0)},${y(v)}`;
        return step ? `H${x(i)}V${y(v)}` : `L${x(i)},${y(v)}`;
      })
      .join("");

  // Evenly spaced x ticks (same index interval), always ending on the last point.
  const xTickIdx = useMemo(() => {
    const every = Math.max(1, Math.ceil((n - 1) / 5));
    const idx: number[] = [];
    for (let i = 0; i < n; i += every) idx.push(i);
    if (n - 1 - idx[idx.length - 1] >= every / 2) idx.push(n - 1);
    else idx[idx.length - 1] = n - 1;
    return idx;
  }, [n]);

  // Direct end labels, stacked upward when endpoints are too close to read.
  const endLabels = useMemo(() => {
    const placed: { key: string; x: number; y: number; text: string }[] = [];
    const items = series
      .filter((s) => s.endLabel)
      .map((s) => ({ key: s.key, x: x(s.values.length - 1), y: y(s.values[s.values.length - 1]) - 10, text: s.endLabel! }))
      .sort((a, b) => a.x - b.x);
    for (const it of items) {
      let ly = it.y;
      while (placed.some((p) => Math.abs(p.x - it.x) < 48 && Math.abs(p.y - ly) < 13)) ly -= 14;
      placed.push({ ...it, y: ly });
    }
    return placed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, n, hi, lo]);

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <div className="relative">
      {series.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-slate-600">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className="h-[3px] w-4 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible" role="img" aria-label={ariaLabel}>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#e8edf3" strokeWidth={1} />
            <text x={pad.l - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-slate-400 text-[10.5px]">
              {formatY(t)}
            </text>
          </g>
        ))}
        {xTickIdx.map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className="fill-slate-400 text-[10.5px]">
            {formatX(i)}
          </text>
        ))}
        {series.map((s) => (
          <path key={s.key} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="chart-line" />
        ))}
        {series.map((s) => (
          <circle key={`${s.key}-end`} cx={x(s.values.length - 1)} cy={y(s.values[s.values.length - 1])} r={4.5} fill={s.color} stroke="white" strokeWidth={2} />
        ))}
        {endLabels.map((l) => (
          <text key={l.key} x={l.x} y={l.y} textAnchor="middle" className="fill-slate-600 text-[10.5px] font-medium">
            {l.text}
          </text>
        ))}
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="#94a3b8" strokeWidth={1} />
            {series.map((s) =>
              hover < s.values.length ? <circle key={s.key} cx={x(hover)} cy={y(s.values[hover])} r={4.5} fill={s.color} stroke="white" strokeWidth={2} /> : null,
            )}
          </g>
        )}
        <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-6 z-10 min-w-36 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-2 text-[11.5px] shadow-lg backdrop-blur"
          style={{ left: `${Math.min(70, Math.max(2, (x(hover) / W) * 100 - 8))}%` }}
        >
          <div className="mb-1 font-medium text-slate-700">{formatX(hover)}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-slate-500">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="font-mono tabular-nums text-slate-800">{hover < s.values.length ? formatY(s.values[hover]) : "closed"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
