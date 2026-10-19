"use client";

import { atHeightAgl, MS_TO_KT, type Sounding } from "@/lib/pro/thermo";

const R = 120;
/** Ring spacing and outer ring, kt. */
const RINGS = [20, 40, 60, 80];

/** Height bands in the SPC colours: 0–1, 1–3, 3–6, 6–9, 9–12 km. */
const BANDS: { from: number; to: number; color: string }[] = [
  { from: 0, to: 1000, color: "#ec4899" },
  { from: 1000, to: 3000, color: "#ef4444" },
  { from: 3000, to: 6000, color: "#22c55e" },
  { from: 6000, to: 9000, color: "#eab308" },
  { from: 9000, to: 12000, color: "#22d3ee" },
];

type Vec = { u: number; v: number };

export function Hodograph({ sounding, rm, lm, mean, observed }: { sounding: Sounding; rm?: Vec | null; lm?: Vec | null; mean?: Vec | null; observed?: Vec | null }) {
  const top = Math.max(...RINGS);
  const sc = R / top;
  // m/s → kt → px; north up.
  const px = (w: Vec) => [w.u * MS_TO_KT * sc, -w.v * MS_TO_KT * sc] as const;
  const at = (agl: number): Vec | null => {
    const u = atHeightAgl(sounding, agl, (l) => l.u);
    const v = atHeightAgl(sounding, agl, (l) => l.v);
    return u == null || v == null ? null : { u, v };
  };
  const segments = BANDS.map((b) => {
    const pts: string[] = [];
    for (let z = b.from; z <= b.to; z += 250) {
      const w = at(z);
      if (w) pts.push(px(w).map((n) => n.toFixed(1)).join(","));
    }
    return { ...b, d: pts.length > 1 ? `M${pts.join("L")}` : "" };
  });
  const mark = (w: Vec | null | undefined, label: string, color: string) => {
    if (!w) return null;
    const [x, y] = px(w);
    return (
      <g>
        <circle cx={x} cy={y} r={3.5} fill={color} stroke="#000" strokeWidth={1} />
        <text x={x + 5} y={y - 4} className="text-[9px]" fill={color}>
          {label}
        </text>
      </g>
    );
  };
  return (
    <svg viewBox={`${-R - 8} ${-R - 8} ${2 * R + 16} ${2 * R + 16}`} className="h-auto w-full" role="img" aria-label="Hodograph">
      <rect x={-R - 8} y={-R - 8} width={2 * R + 16} height={2 * R + 16} fill="var(--color-surface-1)" />
      {RINGS.map((k) => (
        <g key={k}>
          <circle r={k * sc} fill="none" stroke="var(--color-line)" strokeWidth={0.7} />
          <text x={k * sc * 0.71 + 2} y={-k * sc * 0.71 - 2} className="fill-ink-3 text-[8px]">
            {k}
          </text>
        </g>
      ))}
      <line x1={-R} x2={R} y1={0} y2={0} stroke="var(--color-line)" strokeWidth={0.7} />
      <line y1={-R} y2={R} x1={0} x2={0} stroke="var(--color-line)" strokeWidth={0.7} />
      {segments.map((s) => s.d && <path key={s.from} d={s.d} fill="none" stroke={s.color} strokeWidth={2.4} strokeLinejoin="round" />)}
      {mark(mean, "MW", "#a3a3a3")}
      {mark(lm, "LM", "#60a5fa")}
      {mark(rm, "RM", "#f87171")}
      {mark(observed, "OBS", "#f472b6")}
    </svg>
  );
}
