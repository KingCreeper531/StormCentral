"use client";

import { motion } from "motion/react";

/** Radial meter: the fill carries the value, the track is the same hue dimmed. */
export function ScoreRing({
  value,
  max = 100,
  color,
  size = 132,
  stroke = 10,
  children,
  label,
}: {
  value: number;
  max?: number;
  color: string;
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
  label: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / max));
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }} role="meter" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={max}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeOpacity={0.16} strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ type: "spring", stiffness: 60, damping: 18 }}
          style={{ filter: `drop-shadow(0 0 10px ${color}55)` }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}
