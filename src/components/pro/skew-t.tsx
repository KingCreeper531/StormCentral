"use client";

import { useMemo } from "react";
import { dewpointFromMixingRatio, moistAdiabat, MS_TO_KT, windFrom, type ParcelResult, type Sounding } from "@/lib/pro/thermo";

const W = 360;
const H = 380;
const P_BOTTOM = 1050;
const P_TOP = 100;
/** Temperature at the bottom-left corner and the span across the plot (°C). */
const T_LEFT = -40;
const T_SPAN = 90;
const BARB_X = W + 18;

/** Log-pressure height: P_BOTTOM at the bottom edge, P_TOP at the top. */
const yOf = (p: number) => H - (H * Math.log(P_BOTTOM / p)) / Math.log(P_BOTTOM / P_TOP);
/** 45° skew: isotherms lean right one pixel per pixel of height. */
const xOf = (t: number, p: number) => ((t - T_LEFT) / T_SPAN) * W + (H - yOf(p)) * 0.95;

const path = (pts: readonly (readonly [number, number])[]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
const PS: number[] = [];
for (let p = P_BOTTOM; p >= P_TOP; p -= 10) PS.push(p);

function Background() {
  const iso = useMemo(() => Array.from({ length: 16 }, (_, i) => -100 + i * 10), []);
  const dry = useMemo(() => Array.from({ length: 22 }, (_, i) => -30 + i * 10), []);
  const moist = useMemo(() => Array.from({ length: 10 }, (_, i) => -10 + i * 5), []);
  const mix = [1, 2, 4, 8, 12, 16, 20];
  return (
    <g>
      {[1000, 850, 700, 500, 400, 300, 250, 200, 150, 100].map((p) => (
        <g key={p}>
          <line x1={0} x2={W} y1={yOf(p)} y2={yOf(p)} stroke="var(--color-line)" strokeWidth={0.6} />
          <text x={-4} y={yOf(p) + 3} textAnchor="end" className="fill-ink-3 text-[9px]">
            {p}
          </text>
        </g>
      ))}
      {iso.map((t) => (
        <line key={t} x1={xOf(t, P_BOTTOM)} y1={H} x2={xOf(t, P_TOP)} y2={0} stroke={t === 0 ? "#60a5fa" : "var(--color-line)"} strokeWidth={t === 0 ? 0.9 : 0.5} />
      ))}
      {dry.map((th) => (
        <path key={th} d={path(PS.map((p) => [xOf((th + 273.15) * Math.pow(p / 1000, 0.2857) - 273.15, p), yOf(p)]))} fill="none" stroke="#a16207" strokeOpacity={0.35} strokeWidth={0.6} />
      ))}
      {moist.map((t0) => (
        <path key={t0} d={path(PS.filter((p) => p <= 1000 && p >= 200).map((p) => [xOf(moistAdiabat(1000, t0, p), p), yOf(p)]))} fill="none" stroke="#16a34a" strokeOpacity={0.35} strokeWidth={0.6} strokeDasharray="3 2" />
      ))}
      {mix.map((w) => (
        <path key={w} d={path(PS.filter((p) => p >= 600).map((p) => [xOf(dewpointFromMixingRatio(p, w / 1000), p), yOf(p)]))} fill="none" stroke="#0891b2" strokeOpacity={0.45} strokeWidth={0.6} strokeDasharray="1 2" />
      ))}
      {[-30, -20, -10, 0, 10, 20, 30, 40].map((t) => (
        <text key={t} x={xOf(t, P_BOTTOM)} y={H + 11} textAnchor="middle" className="fill-ink-3 text-[9px]">
          {t}
        </text>
      ))}
    </g>
  );
}

/** A wind barb at (x, y): staff points into the wind; 50 kt pennants, 10 kt barbs, 5 kt half barbs. */
function Barb({ x, y, dir, kt }: { x: number; y: number; dir: number; kt: number }) {
  if (kt < 2.5) return <circle cx={x} cy={y} r={2.5} fill="none" stroke="currentColor" />;
  let rest = Math.round(kt / 5) * 5;
  const parts: React.ReactNode[] = [];
  let pos = 0;
  const L = 22;
  while (rest >= 50) {
    parts.push(<path key={`p${pos}`} d={`M0,${-L + pos} L8,${-L + pos + 2.5} L0,${-L + pos + 5} Z`} fill="currentColor" />);
    pos += 6;
    rest -= 50;
  }
  while (rest >= 10) {
    parts.push(<line key={`b${pos}`} x1={0} y1={-L + pos} x2={8} y2={-L + pos - 3} stroke="currentColor" />);
    pos += 3.5;
    rest -= 10;
  }
  if (rest >= 5) parts.push(<line key="h" x1={0} y1={-L + pos + (pos ? 0 : 3.5)} x2={4.5} y2={-L + pos + (pos ? 0 : 3.5) - 1.7} stroke="currentColor" />);
  return (
    <g transform={`translate(${x},${y}) rotate(${dir})`}>
      <line x1={0} y1={0} x2={0} y2={-L} stroke="currentColor" />
      {parts}
    </g>
  );
}

export function SkewT({ sounding, parcel }: { sounding: Sounding; parcel: ParcelResult | null }) {
  const L = sounding.levels;
  const tLine = path(L.map((l) => [xOf(l.t, l.p), yOf(l.p)]));
  const tdLine = path(L.map((l) => [xOf(l.td, l.p), yOf(l.p)]));
  const trace = parcel ? path(parcel.trace.filter((s) => s.p >= P_TOP).map((s) => [xOf(s.t, s.p), yOf(s.p)])) : "";
  const barbs = L.filter((l, i) => i === 0 || l.p <= L[0]!.p - 20).filter((l) => l.p >= P_TOP);
  return (
    <svg viewBox={`-30 -6 ${W + 64} ${H + 22}`} className="h-auto w-full text-ink" role="img" aria-label="Skew-T log-P diagram">
      <defs>
        <clipPath id="skewt-clip">
          <rect x={0} y={0} width={W} height={H} />
        </clipPath>
      </defs>
      <rect x={0} y={0} width={W} height={H} fill="var(--color-surface-1)" stroke="var(--color-line-strong)" strokeWidth={0.8} />
      <g clipPath="url(#skewt-clip)">
        <Background />
        {trace && <path d={trace} fill="none" stroke="currentColor" strokeWidth={1.2} strokeDasharray="4 3" opacity={0.85} />}
        <path d={tdLine} fill="none" stroke="#22c55e" strokeWidth={2} />
        <path d={tLine} fill="none" stroke="#ef4444" strokeWidth={2} />
        {parcel?.lclP && (
          <g>
            <line x1={W - 40} x2={W - 4} y1={yOf(parcel.lclP)} y2={yOf(parcel.lclP)} stroke="#22c55e" strokeWidth={1.2} />
            <text x={W - 42} y={yOf(parcel.lclP) + 3} textAnchor="end" className="fill-[#22c55e] text-[9px]">
              LCL
            </text>
          </g>
        )}
        {parcel?.lfcP && (
          <g>
            <line x1={W - 40} x2={W - 4} y1={yOf(parcel.lfcP)} y2={yOf(parcel.lfcP)} stroke="#eab308" strokeWidth={1.2} />
            <text x={W - 42} y={yOf(parcel.lfcP) + 3} textAnchor="end" className="fill-[#eab308] text-[9px]">
              LFC
            </text>
          </g>
        )}
        {parcel?.elP && (
          <g>
            <line x1={W - 40} x2={W - 4} y1={yOf(parcel.elP)} y2={yOf(parcel.elP)} stroke="#a855f7" strokeWidth={1.2} />
            <text x={W - 42} y={yOf(parcel.elP) + 3} textAnchor="end" className="fill-[#a855f7] text-[9px]">
              EL
            </text>
          </g>
        )}
      </g>
      <line x1={BARB_X} x2={BARB_X} y1={0} y2={H} stroke="var(--color-line)" strokeWidth={0.6} />
      {barbs.map((l) => {
        const w = windFrom(l.u, l.v);
        return <Barb key={l.p} x={BARB_X} y={yOf(l.p)} dir={w.dir} kt={w.spd * MS_TO_KT} />;
      })}
    </svg>
  );
}
