"use client";

import { useMemo, useState } from "react";
import { monotonePath, niceTicks, roundedBar, segments } from "@/lib/charts";
import { useMeasure } from "@/hooks/use-measure";
import { cn } from "@/lib/utils";

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
  values: ReadonlyArray<number | null>;
  kind?: "line" | "area" | "bar";
  dashed?: boolean;
  format?: (v: number) => string;
  /** Compact formatter for y-axis ticks (defaults to `format`). */
  axisFormat?: (v: number) => string;
}

export interface Threshold {
  value: number;
  label: string;
  color?: string;
}

export interface Band {
  from: number;
  to: number;
  color: string;
  label?: string;
}

interface Props {
  /** Epoch milliseconds, ascending. */
  times: readonly number[];
  series: SeriesDef[];
  height?: number;
  yDomain?: [number | null, number | null];
  thresholds?: Threshold[];
  bands?: Band[];
  now?: number;
  timeZone?: string;
  compact?: boolean;
  /** Hide the legend (single-series charts are named by their card title). */
  legend?: boolean;
  ariaLabel: string;
  className?: string;
  tickEvery?: number;
}

const PAD = { top: 10, right: 10, bottom: 22, left: 38 };
const PAD_COMPACT = { top: 4, right: 2, bottom: 2, left: 2 };

export function TimeSeriesChart({
  times,
  series,
  height = 160,
  yDomain,
  thresholds = [],
  bands = [],
  now,
  timeZone,
  compact = false,
  legend,
  ariaLabel,
  className,
  tickEvery,
}: Props) {
  const [ref, { width }] = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = compact ? PAD_COMPACT : PAD;
  const showLegend = legend ?? series.length > 1;

  const geo = useMemo(() => {
    const t0 = times[0] ?? 0;
    const t1 = times[times.length - 1] ?? 1;
    const all = series.flatMap((s) => s.values.filter((v): v is number => v != null && Number.isFinite(v)));
    for (const th of thresholds) all.push(th.value);
    let lo = yDomain?.[0] ?? Math.min(...all);
    let hi = yDomain?.[1] ?? Math.max(...all);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      lo = 0;
      hi = 1;
    }
    if (series.some((s) => s.kind === "bar")) lo = Math.min(lo, 0);
    if (lo === hi) hi = lo + 1;
    const ticks = compact ? [] : niceTicks(lo, hi, height < 120 ? 3 : 5);
    if (ticks.length && yDomain?.[0] == null) lo = Math.min(lo, ticks[0]!);
    if (ticks.length && yDomain?.[1] == null) hi = Math.max(hi, ticks[ticks.length - 1]!);
    const innerW = Math.max(1, width - pad.left - pad.right);
    const innerH = Math.max(1, height - pad.top - pad.bottom);
    const slot = innerW / Math.max(1, times.length);
    // Bars are centred on their timestamp, so inset the x-range by half a slot
    // to keep the first/last bar off the axis labels and inside the plot.
    const inset = series.some((s) => s.kind === "bar") ? slot / 2 : 0;
    const sx = (t: number) => pad.left + inset + ((t - t0) / (t1 - t0 || 1)) * (innerW - 2 * inset);
    const sy = (v: number) => pad.top + (1 - (v - lo) / (hi - lo)) * innerH;
    return { t0, t1, lo, hi, ticks: ticks.filter((v) => v >= lo && v <= hi), sx, sy, innerW, innerH, slot };
  }, [times, series, thresholds, yDomain, width, height, pad, compact]);

  const xTicks = useMemo(() => {
    if (compact || !times.length) return [];
    const fmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", timeZone });
    const every = tickEvery ?? Math.max(1, Math.ceil(times.length / Math.max(2, Math.floor(geo.innerW / 64))));
    return times.map((t, i) => ({ t, i })).filter(({ i }) => i % every === 0).map(({ t }) => ({ t, label: fmt.format(t) }));
  }, [times, compact, geo.innerW, timeZone, tickEvery]);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - box.left;
    const t = geo.t0 + (x / box.width) * (geo.t1 - geo.t0);
    let best = 0;
    for (let i = 1; i < times.length; i++) if (Math.abs(times[i]! - t) < Math.abs(times[best]! - t)) best = i;
    setHover(best);
  };

  const fmtTime = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit", timeZone });
  const hx = hover != null ? geo.sx(times[hover]!) : 0;

  return (
    <div className={cn("relative w-full select-none", className)}>
      {showLegend && (
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-2" aria-label="Legend">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3.5 rounded-full" style={{ background: s.color, height: s.kind === "bar" ? 8 : 2, width: s.kind === "bar" ? 8 : 14, borderRadius: s.kind === "bar" ? 2 : 999 }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div ref={ref} className="relative w-full min-w-0 overflow-visible" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={ariaLabel} className="absolute inset-0 overflow-visible">
            {bands.map((b, i) => {
              const x0 = Math.max(pad.left, geo.sx(b.from));
              const x1 = Math.min(width - pad.right, geo.sx(b.to));
              return x1 > x0 ? <rect key={i} x={x0} y={pad.top} width={x1 - x0} height={geo.innerH} fill={b.color} /> : null;
            })}
            {geo.ticks.map((v) => (
              <g key={v}>
                <line x1={pad.left} x2={width - pad.right} y1={geo.sy(v)} y2={geo.sy(v)} stroke="var(--color-grid)" strokeWidth={1} />
                <text x={pad.left - 6} y={geo.sy(v)} dy="0.32em" textAnchor="end" className="fill-ink-3 tabular text-[10px]">
                  {(series[0]?.axisFormat ?? series[0]?.format)?.(v) ?? v}
                </text>
              </g>
            ))}
            {xTicks.map(({ t, label }) => (
              <text key={t} x={geo.sx(t)} y={height - 6} textAnchor="middle" className="fill-ink-3 text-[10px]">
                {label}
              </text>
            ))}
            {series.map((s) => {
              if (s.kind === "bar") {
                const w = Math.min(24, Math.max(2, geo.slot * 0.62));
                const base = geo.sy(Math.max(geo.lo, 0));
                return (
                  <g key={s.key}>
                    {s.values.map((v, i) => {
                      if (v == null || v <= 0) return null;
                      const y = geo.sy(v);
                      return <path key={i} d={roundedBar(geo.sx(times[i]!) - w / 2, y, w, base - y)} fill={s.color} opacity={hover == null || hover === i ? 1 : 0.55} />;
                    })}
                  </g>
                );
              }
              const segs = segments(times, s.values, geo.sx, geo.sy);
              return (
                <g key={s.key}>
                  {s.kind === "area" &&
                    segs.map((pts, i) =>
                      pts.length > 1 ? (
                        <path
                          key={`a${i}`}
                          d={`${monotonePath(pts)}L${pts[pts.length - 1]!.x},${pad.top + geo.innerH}L${pts[0]!.x},${pad.top + geo.innerH}Z`}
                          fill={s.color}
                          opacity={0.1}
                        />
                      ) : null,
                    )}
                  {segs.map((pts, i) => (
                    <path
                      key={i}
                      d={monotonePath(pts)}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={compact ? 1.75 : 2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray={s.dashed ? "5 4" : undefined}
                    />
                  ))}
                </g>
              );
            })}
            {thresholds.map((th) => (
              <g key={th.label}>
                <line x1={pad.left} x2={width - pad.right} y1={geo.sy(th.value)} y2={geo.sy(th.value)} stroke={th.color ?? "var(--color-nogo)"} strokeWidth={1} strokeDasharray="4 4" />
                {!compact && (
                  <text x={width - pad.right} y={geo.sy(th.value) - 4} textAnchor="end" className="fill-ink-2 text-[10px]">
                    {th.label}
                  </text>
                )}
              </g>
            ))}
            {now != null && now >= geo.t0 && now <= geo.t1 && (
              <line x1={geo.sx(now)} x2={geo.sx(now)} y1={pad.top} y2={pad.top + geo.innerH} stroke="white" strokeOpacity={0.35} strokeWidth={1} />
            )}
            {hover != null && (
              <g pointerEvents="none">
                <line x1={hx} x2={hx} y1={pad.top} y2={pad.top + geo.innerH} stroke="white" strokeOpacity={0.5} strokeWidth={1} />
                {series.map((s) => {
                  const v = s.values[hover];
                  if (v == null || s.kind === "bar") return null;
                  return <circle key={s.key} cx={hx} cy={geo.sy(v)} r={4} fill={s.color} stroke="#0a0c10" strokeWidth={2} />;
                })}
              </g>
            )}
            <rect
              x={pad.left}
              y={0}
              width={geo.innerW}
              height={height}
              fill="transparent"
              onPointerMove={onMove}
              onPointerDown={onMove}
              onPointerLeave={() => setHover(null)}
              style={{ touchAction: "pan-y" }}
            />
          </svg>
        )}
        {hover != null && width > 0 && (
          <div
            className="glass-strong pointer-events-none absolute top-0 z-10 min-w-28 rounded-xl px-2.5 py-1.5 text-[11px]"
            style={{ left: Math.min(Math.max(hx + 10, 0), width - 130) }}
          >
            <p className="mb-0.5 text-ink-3">{fmtTime.format(times[hover]!)}</p>
            {series.map((s) => {
              const v = s.values[hover];
              return (
                <p key={s.key} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-ink-2">
                    <span className="size-2 rounded-full" style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <span className="tabular font-semibold text-ink">{v == null ? "—" : s.format ? s.format(v) : v.toFixed(1)}</span>
                </p>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
