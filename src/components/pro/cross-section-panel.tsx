"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useFormat } from "@/hooks/use-format";
import { useT } from "@/lib/i18n/use-t";
import { haversineKm, type LatLon } from "@/lib/geo";
import { crossSection, PROFILE_LEVELS } from "@/lib/pro/model";
import { atPressure, thetaE } from "@/lib/pro/thermo";

const W = 360;
const H = 220;
const P_BOTTOM = 1000;
const P_TOP = 200;
const LEVELS = PROFILE_LEVELS.filter((p) => p >= P_TOP);
/** Log-pressure height: P_BOTTOM at the bottom edge, P_TOP at the top. */
const yOf = (p: number) => H - (H * Math.log(P_BOTTOM / p)) / Math.log(P_BOTTOM / P_TOP);

/** θe colour ramp (K). */
const RAMP: [number, [number, number, number]][] = [
  [295, [49, 54, 149]],
  [310, [69, 117, 180]],
  [320, [116, 173, 209]],
  [330, [171, 217, 233]],
  [338, [254, 224, 144]],
  [346, [253, 174, 97]],
  [354, [244, 109, 67]],
  [362, [215, 48, 39]],
  [370, [165, 0, 38]],
];

function color(v: number): string {
  if (v <= RAMP[0]![0]) return `rgb(${RAMP[0]![1].join(",")})`;
  for (let i = 1; i < RAMP.length; i++) {
    const [v1, c1] = RAMP[i]!;
    const [v0, c0] = RAMP[i - 1]!;
    if (v <= v1) {
      const f = (v - v0) / (v1 - v0);
      return `rgb(${c0.map((c, k) => Math.round(c + f * (c1[k]! - c))).join(",")})`;
    }
  }
  return `rgb(${RAMP.at(-1)![1].join(",")})`;
}

/**
 * Vertical cross-section along A–A′ from the model: equivalent potential
 * temperature shading (moisture and instability in one field), the 0 °C and
 * −20 °C isotherms (hail growth zone between them) and the terrain.
 */
export function CrossSectionPanel({ a, b }: { a: LatLon; b: LatLon }) {
  const t = useT();
  const f = useFormat();
  const key = [a.lat, a.lon, b.lat, b.lon].map((n) => n.toFixed(2)).join(",");
  const q = useQuery({ queryKey: ["pro-xsect", key], queryFn: ({ signal }) => crossSection(a, b, 24, signal), staleTime: 10 * 60_000, retry: 1 });
  const cols = q.data;

  const grid = useMemo(() => {
    if (!cols?.length) return null;
    const n = cols.length;
    const dx = W / n;
    const cells: { x: number; y: number; w: number; h: number; fill: string }[] = [];
    const iso: Record<number, [number, number][]> = { 0: [], [-20]: [] };
    const ground: [number, number][] = [];
    cols.forEach((c, i) => {
      const x = i * dx;
      const s = c.sounding;
      const sfcP = s?.levels[0]?.p ?? c.sfc.p ?? P_BOTTOM;
      ground.push([x + dx / 2, yOf(Math.min(P_BOTTOM, sfcP))]);
      if (!s) return;
      LEVELS.forEach((p, k) => {
        if (p > sfcP) return;
        const tt = atPressure(s.levels, p, (l) => l.t);
        const td = atPressure(s.levels, p, (l) => l.td);
        if (tt == null || td == null) return;
        const pBelow = k === 0 ? P_BOTTOM : Math.sqrt(p * LEVELS[k - 1]!);
        const pAbove = k === LEVELS.length - 1 ? P_TOP : Math.sqrt(p * LEVELS[k + 1]!);
        const y0 = yOf(Math.min(pBelow, sfcP));
        const y1 = yOf(pAbove);
        cells.push({ x, y: y1, w: dx + 0.5, h: y0 - y1 + 0.5, fill: color(thetaE(p, tt, td)) });
      });
      for (const target of [0, -20]) {
        for (let k = 1; k < s.levels.length; k++) {
          const lo = s.levels[k - 1]!;
          const hi = s.levels[k]!;
          if ((lo.t - target) * (hi.t - target) <= 0 && lo.t !== hi.t) {
            const fr = (lo.t - target) / (lo.t - hi.t);
            const p = Math.exp(Math.log(lo.p) + fr * (Math.log(hi.p) - Math.log(lo.p)));
            if (p >= P_TOP) iso[target]!.push([x + dx / 2, yOf(p)]);
            break;
          }
        }
      }
    });
    return { cells, iso, ground };
  }, [cols]);

  const km = haversineKm(a, b);
  if (q.isLoading) return <p className="p-3 text-[12px] text-ink-3">{t("Loading the cross-section…")}</p>;
  if (q.isError || !grid) return <p className="p-3 text-[12px] text-caution">{t("Couldn't load the cross-section. Try again in a moment.")}</p>;
  const line = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");

  return (
    <div className="space-y-2 p-3">
      <svg viewBox={`-34 -6 ${W + 40} ${H + 24}`} className="h-auto w-full" role="img" aria-label={t("Vertical cross-section")}>
        <rect x={0} y={0} width={W} height={H} fill="var(--color-surface-2)" />
        {grid.cells.map((c, i) => (
          <rect key={i} x={c.x} y={c.y} width={c.w} height={c.h} fill={c.fill} />
        ))}
        {[1000, 850, 700, 500, 300, 200].map((p) => (
          <g key={p}>
            <line x1={0} x2={W} y1={yOf(p)} y2={yOf(p)} stroke="#000" strokeOpacity={0.25} strokeWidth={0.6} />
            <text x={-4} y={yOf(p) + 3} textAnchor="end" className="fill-ink-3 text-[9px]">
              {p}
            </text>
          </g>
        ))}
        {grid.iso[0]!.length > 1 && <path d={line(grid.iso[0]!)} fill="none" stroke="#fff" strokeWidth={1.6} strokeDasharray="5 3" />}
        {grid.iso[-20]!.length > 1 && <path d={line(grid.iso[-20]!)} fill="none" stroke="#e0f2fe" strokeWidth={1.2} strokeDasharray="2 2" />}
        <path d={`${line(grid.ground)}L${W},${H}L0,${H}Z`} fill="#3f3a33" />
        <text x={2} y={H + 13} className="fill-ink-2 text-[10px] font-semibold">
          A
        </text>
        <text x={W - 2} y={H + 13} textAnchor="end" className="fill-ink-2 text-[10px] font-semibold">
          A′
        </text>
        <text x={W / 2} y={H + 13} textAnchor="middle" className="fill-ink-3 text-[9px]">
          {f.distanceKm(km)}
        </text>
      </svg>
      <div className="flex items-center gap-2 text-[10px] text-ink-3">
        <span>θe</span>
        <span className="h-2 flex-1 rounded-sm" style={{ background: `linear-gradient(90deg, ${RAMP.map(([v]) => color(v)).join(", ")})` }} />
        <span className="font-mono">295–370 K</span>
      </div>
      <p className="text-[10px] leading-snug text-ink-3">{t("Dashed lines: 0 °C (white) and −20 °C (blue), the hail growth zone between them. Model data for the current hour.")}</p>
    </div>
  );
}
