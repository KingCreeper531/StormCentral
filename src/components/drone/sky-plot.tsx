"use client";

import type { ConstellationName as Constellation, GnssResponse } from "@/lib/api/types";

type SkySat = GnssResponse["sats"][number];

export const CONSTELLATIONS: readonly Constellation[] = ["GPS", "GLONASS", "Galileo", "BeiDou"];

/**
 * Polar sky plot (N up, zenith centre, horizon rim). Constellations are
 * encoded by colour *and* marker shape — four hues can't be told apart by
 * colour alone under every colour-vision deficiency.
 */
export const CONSTELLATION_STYLE: Record<Constellation, { color: string; shape: "circle" | "square" | "triangle" | "diamond" }> = {
  GPS: { color: "#3987e5", shape: "circle" },
  GLONASS: { color: "#d95926", shape: "square" },
  Galileo: { color: "#199e70", shape: "triangle" },
  BeiDou: { color: "#c98500", shape: "diamond" },
};

export function Marker({ shape, x, y, r, color }: { shape: string; x: number; y: number; r: number; color: string }) {
  const common = { fill: color, stroke: "#0a0c10", strokeWidth: 2 };
  if (shape === "square") return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} rx={1.5} {...common} />;
  if (shape === "triangle") return <path d={`M${x},${y - r * 1.2} L${x + r * 1.1},${y + r * 0.8} L${x - r * 1.1},${y + r * 0.8}Z`} {...common} />;
  if (shape === "diamond") return <path d={`M${x},${y - r * 1.25} L${x + r * 1.1},${y} L${x},${y + r * 1.25} L${x - r * 1.1},${y}Z`} {...common} />;
  return <circle cx={x} cy={y} r={r} {...common} />;
}

export function SkyPlot({ sats, size = 220 }: { sats: SkySat[]; size?: number }) {
  const c = size / 2;
  const R = c - 14;
  const pos = (az: number, el: number) => {
    const r = ((90 - el) / 90) * R;
    const a = (az * Math.PI) / 180;
    return { x: c + r * Math.sin(a), y: c - r * Math.cos(a) };
  };
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Sky plot: ${sats.length} satellites above the 10° mask`}>
      {[0, 30, 60].map((el) => (
        <circle key={el} cx={c} cy={c} r={((90 - el) / 90) * R} fill="none" stroke="var(--color-grid)" strokeWidth={1} />
      ))}
      <circle cx={c} cy={c} r={((90 - 10) / 90) * R} fill="none" stroke="white" strokeOpacity={0.18} strokeDasharray="3 4" />
      {[0, 90, 180, 270].map((az) => {
        const p = pos(az, 0);
        return <line key={az} x1={c} y1={c} x2={p.x} y2={p.y} stroke="var(--color-grid)" />;
      })}
      {(["N", "E", "S", "W"] as const).map((l, i) => {
        const p = pos(i * 90, -12);
        return (
          <text key={l} x={p.x} y={p.y} dy="0.35em" textAnchor="middle" className="fill-ink-3 text-[10px] font-semibold">
            {l}
          </text>
        );
      })}
      {sats.map((s) => {
        const p = pos(s.azimuthDeg, s.elevationDeg);
        const st = CONSTELLATION_STYLE[s.constellation];
        return (
          <g key={`${s.constellation}-${s.name}`}>
            <title>{`${s.name} · el ${Math.round(s.elevationDeg)}° az ${Math.round(s.azimuthDeg)}°`}</title>
            <Marker shape={st.shape} x={p.x} y={p.y} r={4.5} color={st.color} />
          </g>
        );
      })}
    </svg>
  );
}
