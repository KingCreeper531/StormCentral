import { compassPoint } from "@/lib/geo";

/** Wind compass: the arrow points where the wind is blowing *to*. */
export function WindCompass({ dirDeg, size = 108, label }: { dirDeg: number | null; size?: number; label: string }) {
  const r = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
      <circle cx={r} cy={r} r={r - 2} fill="none" stroke="var(--color-grid)" strokeWidth={1} />
      {Array.from({ length: 36 }, (_, i) => {
        const a = (i * 10 * Math.PI) / 180;
        const long = i % 9 === 0;
        const r1 = r - 4;
        const r2 = r - (long ? 11 : 7);
        return (
          <line key={i} x1={r + r1 * Math.sin(a)} y1={r - r1 * Math.cos(a)} x2={r + r2 * Math.sin(a)} y2={r - r2 * Math.cos(a)} stroke="white" strokeOpacity={long ? 0.5 : 0.18} strokeWidth={1} />
        );
      })}
      {(["N", "E", "S", "W"] as const).map((c, i) => {
        const a = (i * 90 * Math.PI) / 180;
        return (
          <text key={c} x={r + (r - 19) * Math.sin(a)} y={r - (r - 19) * Math.cos(a)} dy="0.35em" textAnchor="middle" className="fill-ink-3 text-[9px] font-semibold">
            {c}
          </text>
        );
      })}
      {dirDeg != null && (
        <g transform={`rotate(${(dirDeg + 180) % 360} ${r} ${r})`} style={{ transition: "transform 1s cubic-bezier(.16,1,.3,1)" }}>
          <line x1={r} y1={r + r * 0.42} x2={r} y2={r - r * 0.5} stroke="var(--color-ink)" strokeWidth={2.5} strokeLinecap="round" />
          <path d={`M${r},${r - r * 0.62} l-6,11 h12 z`} fill="var(--color-ink)" />
          <circle cx={r} cy={r + r * 0.42} r={3} fill="var(--color-ink)" />
        </g>
      )}
      <text x={r} y={r + 4} textAnchor="middle" className="sr-only">
        {dirDeg != null ? compassPoint(dirDeg) : ""}
      </text>
    </svg>
  );
}

/**
 * Sun-path arc between sunrise and sunset with the sun's current position.
 * The arc is a flattened half-ellipse; the height is derived from it so the
 * apex and the sun marker (radius + stroke) always sit inside the viewBox.
 */
export function SunArc({ progress, width = 200 }: { progress: number | null; width?: number }) {
  const r = width / 2 - 10;
  const ry = r * 0.6;
  const h = ry + 18;
  const cx = width / 2;
  const cy = h - 8;
  const p = progress == null ? null : Math.max(0, Math.min(1, progress));
  const ang = p == null ? 0 : Math.PI * (1 - p);
  const sx = cx + r * Math.cos(ang);
  const sy = cy - ry * Math.sin(ang);
  return (
    <svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} aria-hidden>
      <line x1={4} x2={width - 4} y1={cy} y2={cy} stroke="var(--color-line)" strokeWidth={1} />
      <path d={`M${cx - r},${cy} A${r},${ry} 0 0 1 ${cx + r},${cy}`} fill="none" stroke="var(--color-line-strong)" strokeWidth={1.5} strokeDasharray="3 4" />
      {p != null && p > 0 && p < 1 && (
        <>
          <path d={`M${cx - r},${cy} A${r},${ry} 0 0 1 ${sx},${sy}`} fill="none" stroke="#f5c451" strokeWidth={2} strokeLinecap="round" />
          <circle cx={sx} cy={sy} r={5.5} fill="#f5c451" stroke="var(--color-surface-1)" strokeWidth={2} />
        </>
      )}
    </svg>
  );
}

/** Moon disc with a geometrically correct terminator. */
export function MoonDisc({ fraction, waxing, size = 64 }: { fraction: number; waxing: boolean; size?: number }) {
  const r = size / 2 - 1;
  const c = size / 2;
  // Terminator ellipse x-radius: |cos(phase angle)| · r ; sweep flips at quarter.
  const k = 1 - 2 * fraction; // +1 new … -1 full
  const rx = Math.abs(k) * r;
  const lit = waxing ? 1 : 0; // lit limb on the right while waxing (N hemisphere)
  const d = `M${c},${c - r} A${r},${r} 0 0 ${lit} ${c},${c + r} A${rx},${r} 0 0 ${k > 0 ? 1 - lit : lit} ${c},${c - r}Z`;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle cx={c} cy={c} r={r} fill="var(--color-surface-3)" />
      <path d={d} fill="#d9d7cf" />
    </svg>
  );
}
