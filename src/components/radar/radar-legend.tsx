import { FAMILIES, legendGradient, type ProductFamily } from "@/lib/radar/products";

const HC_LABELS = ["BIO", "IC", "DS", "WS", "RA", "HR", "BD", "GR", "HA"];

export function RadarLegend({ family }: { family: ProductFamily }) {
  const def = FAMILIES[family];
  const stops = def.legend;
  if (family === "hc") {
    return (
      <div className="glass-strong rounded-xl px-2.5 py-2 text-[10px] text-ink-2">
        <p className="mb-1 font-semibold text-ink">{def.label}</p>
        <div className="grid grid-cols-5 gap-x-2 gap-y-1">
          {stops.map((s, i) => (
            <span key={s.value} className="flex items-center gap-1">
              <span className="size-2 rounded-sm" style={{ background: s.color }} />
              {HC_LABELS[i]}
            </span>
          ))}
        </div>
      </div>
    );
  }
  const mid = stops[Math.floor(stops.length / 2)]!;
  return (
    <div className="glass-strong w-56 rounded-xl px-2.5 py-2 text-[10px] text-ink-3">
      <p className="mb-1 flex justify-between font-semibold text-ink">
        <span>{def.label}</span>
        <span className="text-ink-3">{def.unit}</span>
      </p>
      <div className="h-2 rounded-full" style={{ background: legendGradient(stops) }} />
      <div className="mt-0.5 flex justify-between tabular">
        <span>{stops[0]!.value}</span>
        <span>{mid.value}</span>
        <span>{stops[stops.length - 1]!.value}</span>
      </div>
    </div>
  );
}
