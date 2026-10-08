"use client";

import { useEffect, useMemo, useState } from "react";
import { monotonePath, niceTicks, roundedBar, segments, type Pt } from "@/lib/charts";
import { useMeasure } from "@/hooks/use-measure";
import { cn } from "@/lib/utils";
import { timeTicks } from "./time-ticks";

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
  /** Bars only: per-value fill (e.g. the AQI category colour). Defaults to `color`. */
  colorFor?: (v: number) => string;
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
  /** Label every Nth timestamp instead of choosing round local hours. */
  tickEvery?: number;
}

const PAD = { top: 10, right: 10, bottom: 22, left: 38 };
const PAD_COMPACT = { top: 4, right: 2, bottom: 2, left: 2 };
/** Space between the crosshair and the readout. */
const TIP_GAP = 8;
/** Average glyph width of the 10 px threshold label (slightly generous). */
const LABEL_CHAR_W = 5.8;

const barWidth = (slot: number) => Math.min(24, Math.max(2, slot * 0.62));

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

interface ThresholdLabel {
  th: Threshold;
  /** Null when no in-plot slot is clear: the threshold is keyed in the legend instead. */
  at: { x: number; y: number; anchor: "start" | "end" } | null;
}

interface PlaceInput {
  thresholds: Threshold[];
  series: SeriesDef[];
  times: readonly number[];
  sx: (t: number) => number;
  sy: (v: number) => number;
  lo: number;
  slot: number;
  left: number;
  right: number;
  bottom: number;
}

/** Does the series' ink (bars, or a line with its stroke) intersect the box? */
function seriesHits(s: SeriesDef, box: Box, { times, sx, sy, lo, slot }: PlaceInput): boolean {
  if (s.kind === "bar") {
    const half = barWidth(slot) / 2;
    const base = sy(Math.max(lo, 0));
    return s.values.some((v, i) => {
      if (v == null || v <= 0) return false;
      const x = sx(times[i]!);
      return x + half > box.x0 && x - half < box.x1 && sy(v) < box.y1 && base > box.y0;
    });
  }
  // Monotone curves never overshoot their endpoints, so each segment's y-range bounds it.
  const hitSeg = (a: Pt, b: Pt) =>
    Math.max(a.x, b.x) >= box.x0 && Math.min(a.x, b.x) <= box.x1 && Math.min(a.y, b.y) - 3 < box.y1 && Math.max(a.y, b.y) + 3 > box.y0;
  return segments(times, s.values, sx, sy).some((pts) => (pts.length === 1 ? hitSeg(pts[0]!, pts[0]!) : pts.slice(1).some((p, i) => hitSeg(pts[i]!, p))));
}

/**
 * Put each threshold label where nothing is drawn: right above the line, right
 * below, left above, left below. A label that fits nowhere moves to the legend.
 */
function placeThresholdLabels(input: PlaceInput): ThresholdLabel[] {
  const { thresholds, series, sy, left, right, bottom } = input;
  const placed: Box[] = [];
  return thresholds.map((th) => {
    const y = sy(th.value);
    const w = th.label.length * LABEL_CHAR_W + 6;
    const slots = [
      { x: right, y: y - 4, anchor: "end" as const },
      { x: right, y: y + 12, anchor: "end" as const },
      { x: left, y: y - 4, anchor: "start" as const },
      { x: left, y: y + 12, anchor: "start" as const },
    ];
    for (const at of slots) {
      const box = { x0: at.anchor === "end" ? at.x - w : at.x, x1: at.anchor === "end" ? at.x : at.x + w, y0: at.y - 10, y1: at.y + 2 };
      if (box.y0 < 0 || box.y1 > bottom) continue;
      if (placed.some((b) => b.x0 < box.x1 && b.x1 > box.x0 && b.y0 < box.y1 && b.y1 > box.y0)) continue;
      if (thresholds.some((o) => o !== th && sy(o.value) > box.y0 && sy(o.value) < box.y1)) continue;
      if (series.some((s) => seriesHits(s, box, input))) continue;
      placed.push(box);
      return { th, at };
    }
    return { th, at: null };
  });
}

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
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  // Touch/pen: a tap pins the readout until the next tap outside the chart.
  const [pinned, setPinned] = useState(false);
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
    return { t0, t1, lo, hi, ticks: ticks.filter((v) => v >= lo && v <= hi), sx, sy, innerW, innerH, slot, inset };
  }, [times, series, thresholds, yDomain, width, height, pad, compact]);

  const { t0, t1, innerW } = geo;
  const xTicks = useMemo(() => {
    if (compact || !times.length) return [];
    if (tickEvery || t1 <= t0) {
      const fmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", timeZone });
      return times.filter((_, i) => i % (tickEvery || 1) === 0).map((t) => ({ t, label: fmt.format(t) }));
    }
    // Round local hours (or midnights) spaced by time, at least ~64 px apart.
    return timeTicks(t0, t1, Math.max(2, Math.floor(innerW / 64)), timeZone);
  }, [times, compact, t0, t1, innerW, timeZone, tickEvery]);

  const thresholdLabels =
    compact || width <= 0
      ? thresholds.map((th) => ({ th, at: null }))
      : placeThresholdLabels({
          thresholds,
          series,
          times,
          sx: geo.sx,
          sy: geo.sy,
          lo: geo.lo,
          slot: geo.slot,
          left: pad.left + 4,
          right: width - pad.right,
          bottom: pad.top + geo.innerH,
        });
  // Compact sparklines never label thresholds, so they never key them either.
  const legendThresholds = compact || width <= 0 ? [] : thresholdLabels.filter((l) => l.at == null).map((l) => l.th);

  useEffect(() => {
    if (!pinned) return;
    const dismiss = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      setPinned(false);
      setHoverIdx(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [pinned, ref]);

  /** Snap the pointer to the nearest timestamp (the crosshair finds the x). */
  const pick = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const span = Math.max(1, box.width - 2 * geo.inset);
    const frac = Math.max(0, Math.min(1, (e.clientX - box.left - geo.inset) / span));
    const t = geo.t0 + frac * (geo.t1 - geo.t0);
    let best = 0;
    for (let i = 1; i < times.length; i++) if (Math.abs(times[i]! - t) < Math.abs(times[best]! - t)) best = i;
    setHoverIdx(best);
  };
  const onPointerDown = (e: React.PointerEvent<SVGRectElement>) => {
    pick(e);
    setPinned(e.pointerType !== "mouse");
  };
  const onPointerLeave = () => {
    if (!pinned) setHoverIdx(null);
  };
  // The browser took the gesture for a vertical scroll: drop the readout.
  const onPointerCancel = () => {
    setPinned(false);
    setHoverIdx(null);
  };

  const fmtTime = useMemo(() => new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit", timeZone }), [timeZone]);
  // Guard against a stale index after the data shrinks.
  const hover = hoverIdx != null && hoverIdx < times.length ? hoverIdx : null;
  const hx = hover != null ? geo.sx(times[hover]!) : 0;
  // The readout sits on whichever side of the crosshair has more room, and is
  // capped to that room, so it never spills past the chart edge.
  const flip = hx > width / 2;
  const tipStyle: React.CSSProperties = flip
    ? { right: width - hx + TIP_GAP, maxWidth: Math.max(0, hx - TIP_GAP) }
    : { left: hx + TIP_GAP, maxWidth: Math.max(0, width - hx - TIP_GAP) };

  return (
    <div className={cn("relative w-full select-none", className)}>
      {(showLegend || legendThresholds.length > 0) && (
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="Legend">
          {(showLegend ? series : []).map((s) => (
            <li key={s.key} className="flex min-w-0 items-center gap-1.5">
              {/* The key mirrors the mark: a square for bars/areas, a short stroke for lines. */}
              <svg width={14} height={8} className="shrink-0" aria-hidden>
                {s.kind === "bar" || s.kind === "area" ? (
                  <rect x={3} y={0} width={8} height={8} rx={2} fill={s.color} />
                ) : (
                  <line x1={1} x2={13} y1={4} y2={4} stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? "3 2" : undefined} />
                )}
              </svg>
              {s.label}
            </li>
          ))}
          {/* Thresholds whose label found no clear spot in the plot. */}
          {legendThresholds.map((th) => (
            <li key={`th-${th.label}`} className="flex min-w-0 items-center gap-1.5">
              <svg width={14} height={8} className="shrink-0" aria-hidden>
                <line x1={1} x2={13} y1={4} y2={4} stroke={th.color ?? "var(--color-nogo)"} strokeWidth={1.5} strokeDasharray="3 2" />
              </svg>
              {th.label}
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
                <text x={pad.left - 6} y={geo.sy(v)} dy="0.32em" textAnchor="end" className="fill-ink-3 text-[10px] tabular">
                  {(series[0]?.axisFormat ?? series[0]?.format)?.(v) ?? v}
                </text>
              </g>
            ))}
            {xTicks.map(({ t, label }) => {
              const x = geo.sx(t);
              // Keep a tick at the right edge inside the plot instead of half-clipped.
              return (
                <text key={t} x={x} y={height - 6} textAnchor={x > width - pad.right - 12 ? "end" : "middle"} className="fill-ink-3 text-[10px] tabular">
                  {label}
                </text>
              );
            })}
            {series.map((s) => {
              if (s.kind === "bar") {
                const w = barWidth(geo.slot);
                const base = geo.sy(Math.max(geo.lo, 0));
                return (
                  <g key={s.key}>
                    {s.values.map((v, i) => {
                      if (v == null || v <= 0) return null;
                      const y = geo.sy(v);
                      return (
                        <path
                          key={i}
                          d={roundedBar(geo.sx(times[i]!) - w / 2, y, w, base - y)}
                          fill={s.colorFor?.(v) ?? s.color}
                          opacity={hover == null || hover === i ? 1 : 0.55}
                        />
                      );
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
            {thresholdLabels.map(({ th, at }) => (
              <g key={th.label}>
                <line x1={pad.left} x2={width - pad.right} y1={geo.sy(th.value)} y2={geo.sy(th.value)} stroke={th.color ?? "var(--color-nogo)"} strokeWidth={1} strokeDasharray="4 4" />
                {at && (
                  <text
                    x={at.x}
                    y={at.y}
                    textAnchor={at.anchor}
                    stroke="var(--color-surface-1)"
                    strokeWidth={3}
                    paintOrder="stroke"
                    className="fill-ink-2 text-[10px] tabular"
                  >
                    {th.label}
                  </text>
                )}
              </g>
            ))}
            {now != null && now >= geo.t0 && now <= geo.t1 && (
              <line x1={geo.sx(now)} x2={geo.sx(now)} y1={pad.top} y2={pad.top + geo.innerH} stroke="var(--color-ink-3)" strokeOpacity={0.7} strokeWidth={1} />
            )}
            {hover != null && (
              <g pointerEvents="none">
                <line x1={hx} x2={hx} y1={pad.top} y2={pad.top + geo.innerH} stroke="var(--color-ink-2)" strokeOpacity={0.6} strokeWidth={1} />
                {series.map((s) => {
                  const v = s.values[hover];
                  if (v == null || s.kind === "bar") return null;
                  return <circle key={s.key} cx={hx} cy={geo.sy(v)} r={4} fill={s.color} stroke="var(--color-surface-1)" strokeWidth={2} />;
                })}
              </g>
            )}
            <rect
              x={pad.left}
              y={0}
              width={geo.innerW}
              height={height}
              fill="transparent"
              onPointerMove={pick}
              onPointerDown={onPointerDown}
              onPointerLeave={onPointerLeave}
              onPointerCancel={onPointerCancel}
              style={{ touchAction: "pan-y" }}
            />
          </svg>
        )}
        {hover != null && width > 0 && (
          <div
            className="pointer-events-none absolute top-0 z-10 w-max rounded-[var(--radius-control)] border border-line bg-surface-1 px-2.5 py-1.5 text-xs"
            style={tipStyle}
          >
            <p className="mb-1 truncate text-ink-3 tabular">{fmtTime.format(times[hover]!)}</p>
            {series.map((s) => {
              const v = s.values[hover];
              return (
                <p key={s.key} className="flex items-center justify-between gap-3 leading-5">
                  <span className="flex min-w-0 items-center gap-1.5 text-ink-2">
                    <span className="h-0.5 w-2.5 shrink-0 rounded-[1px]" style={{ background: v != null && s.colorFor ? s.colorFor(v) : s.color }} aria-hidden />
                    <span className="truncate">{s.label}</span>
                  </span>
                  <span className="shrink-0 font-medium whitespace-nowrap text-ink tabular">{v == null ? "—" : s.format ? s.format(v) : v.toFixed(1)}</span>
                </p>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
