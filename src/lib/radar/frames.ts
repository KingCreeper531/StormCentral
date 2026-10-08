/**
 * Radar frame descriptors. A frame is one immutable raster tile pyramid for a
 * single volume-scan time. Timestamped IEM RIDGE tile URLs never change once
 * published, which is what makes cache-first service-worker caching safe.
 */

export const IEM_TILE_ROOT = "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0";

export interface RadarFrame {
  /** Stable id: `${site}-${product}-${yyyymmddhhmm}`. */
  id: string;
  /** Epoch ms of the scan. */
  time: number;
  tileUrl: string;
  /** Source maxzoom — beyond it MapLibre over-zooms instead of fetching. */
  maxzoom: number;
  /** True if `time` is approximate (offset-based mosaic frames). */
  approximate?: boolean;
  /** Model forecast (HRRR) rather than an observed scan. */
  forecast?: boolean;
}

export const MOSAIC_SITE = "USCOMP";

/** `2026-10-07T14:23:00Z` → `202610071423` (UTC). */
export function compactUtc(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

/** WSR-88D ICAO (KLOT, PAHG, TJUA) → IEM's 3-letter id (LOT, AHG, JUA). */
export function iemSiteId(icao: string): string {
  const id = icao.toUpperCase();
  return id.length === 4 ? id.slice(1) : id;
}

export function ridgeTileUrl(site: string, product: string, time: Date): string {
  return `${IEM_TILE_ROOT}/ridge::${site}-${product}-${compactUtc(time)}/{z}/{x}/{y}.png`;
}

export function framesFromScans(
  scans: readonly string[],
  site: string,
  product: string,
  count: number,
): RadarFrame[] {
  const isMosaic = site === MOSAIC_SITE;
  const seen = new Set<string>();
  const frames: RadarFrame[] = [];
  for (const iso of scans) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) continue;
    const d = new Date(t);
    const id = `${site}-${product}-${compactUtc(d)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    frames.push({ id, time: t, tileUrl: ridgeTileUrl(site, product, d), maxzoom: isMosaic ? 8 : 10 });
  }
  frames.sort((a, b) => a.time - b.time);
  return frames.slice(-count);
}

/**
 * Fallback when the scan index is unreachable: IEM's rolling national
 * composite layers (`-m05m` … `-m55m`). Times are approximate (5-min grid,
 * ~5 min latency).
 */
export function mosaicOffsetFrames(now: Date, count: number): RadarFrame[] {
  const n = Math.max(1, Math.min(12, count));
  const base = Math.floor(now.getTime() / 300_000) * 300_000 - 300_000;
  const frames: RadarFrame[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const layer = i === 0 ? "nexrad-n0q-900913" : `nexrad-n0q-900913-m${String(i * 5).padStart(2, "0")}m`;
    frames.push({
      id: `offset-${layer}-${base}`,
      time: base - i * 300_000,
      tileUrl: `${IEM_TILE_ROOT}/${layer}/{z}/{x}/{y}.png`,
      maxzoom: 8,
      approximate: true,
    });
  }
  return frames;
}

/**
 * Frame budget scaled to device memory (Chrome exposes deviceMemory in GB).
 * Each frame holds a full viewport of 256² RGBA textures (~256 KB/tile).
 */
export function frameBudget(deviceMemoryGb: number | undefined): number {
  if (!deviceMemoryGb) return 15;
  if (deviceMemoryGb <= 2) return 8;
  if (deviceMemoryGb <= 4) return 12;
  return 20;
}
