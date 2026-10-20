/**
 * Real radar for the Radar School lessons: a historic storm's NEXRAD Level II
 * volume from NOAA's archive on AWS (Unidata's public bucket, 1991 to now),
 * decoded with the app's own decoder (src/lib/pro/nexrad), sampled onto a
 * small grid around the storm and handed to lesson.html, which paints it with
 * the same colour tables as the simulated examples.
 *
 * Feature positions are found in the data, not typed in: the tornado debris
 * signature (low CC inside strong echoes) and the velocity couplet (the
 * strongest inbound/outbound pair) near the storm, so the rings land on them.
 */
import { gunzipSync } from "node:zlib";
import { parseLevel2, type Moment } from "../src/lib/pro/nexrad/level2";
import { azimuthIndex, levelAt, type Sweep } from "../src/lib/pro/nexrad/sweep";

export const ARCHIVE = "https://unidata-nexrad-level2.s3.amazonaws.com";
const KM_PER_DEG = 111.32;
const KT_TO_MS = 1 / 1.943844;

/** A historic storm to show. */
export interface CaseSpec {
  /** The radar, e.g. "KTLX". */
  site: string;
  /** The scan to show: the last volume starting at or before this (ISO, UTC). */
  time: string;
  /** Centre of the picture and its size (km); the grid is `res` km per cell. */
  lat: number;
  lon: number;
  widthKm: number;
  heightKm: number;
  res?: number;
  /** What the picture is of, for the caption ("Mayfield, Kentucky"). */
  place: string;
  /** Local time zone for the label. */
  zone: string;
}

export interface CaseGrid {
  w: number;
  h: number;
  /** One byte per cell, row by row from the north-west corner; 0 = no data. See decode() in lesson.html. */
  data: string;
}

export interface CaseData {
  site: string;
  place: string;
  /** Volume start, ISO. */
  time: string;
  /** "9:23 PM CST, Dec 10, 2021". */
  label: string;
  widthKm: number;
  heightKm: number;
  res: number;
  /** The radar's position relative to the centre, km (x east, y south). */
  radar: { x: number; y: number };
  grids: Partial<Record<"ref" | "vel" | "cc", CaseGrid>>;
  /** Features found in the data, km from the centre. */
  points: Record<string, { x: number; y: number }>;
}

type Fetch = typeof fetch;

/** The archive's file for `site` at or just before `time`. */
export async function findVolume(site: string, time: string, fetchImpl: Fetch = fetch): Promise<string> {
  const day = time.slice(0, 10).replace(/-/g, "/");
  const res = await fetchImpl(`${ARCHIVE}/?list-type=2&max-keys=1000&prefix=${day}/${site}/`);
  if (!res.ok) throw new Error(`Archive listing for ${site} ${day} failed: ${res.status}`);
  const keys = [...(await res.text()).matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]!).filter((k) => !k.endsWith("_MDM"));
  const target = Date.parse(time);
  const at = (k: string) => {
    const m = k.match(/(\d{4})(\d\d)(\d\d)_(\d\d)(\d\d)(\d\d)/);
    return m ? Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!) : NaN;
  };
  const before = keys.filter((k) => at(k) <= target).sort((a, b) => at(a) - at(b));
  const key = before.at(-1);
  if (!key) throw new Error(`No ${site} volume at or before ${time}`);
  return key;
}

/** Quantised to a byte: reflectivity in half-dBZ from -32, velocity in m/s × 1.6 around 128, CC × 250. */
export const QUANT = {
  ref: { enc: (v: number) => Math.round((v + 32) * 2), dec: (b: number) => b / 2 - 32 },
  vel: { enc: (v: number) => Math.round(v * KT_TO_MS * 1.6 + 128), dec: (b: number) => (b - 128) / 1.6 },
  cc: { enc: (v: number) => Math.round(v * 250), dec: (b: number) => b / 250 },
} as const;

function grid(s: Sweep, kind: keyof typeof QUANT, c: CaseSpec, res: number): { grid: CaseGrid; values: Float32Array } {
  const w = Math.round(c.widthKm / res), h = Math.round(c.heightKm / res);
  const bytes = new Uint8Array(w * h);
  const values = new Float32Array(w * h).fill(NaN);
  const lut = azimuthIndex(s);
  const cosLat = Math.cos((c.lat * Math.PI) / 180);
  for (let j = 0; j < h; j++) {
    const y = -c.heightKm / 2 + (j + 0.5) * res;
    const lat = c.lat - y / KM_PER_DEG;
    for (let i = 0; i < w; i++) {
      const x = -c.widthKm / 2 + (i + 0.5) * res;
      const lon = c.lon + x / (KM_PER_DEG * cosLat);
      const level = levelAt(s, lat, lon, lut);
      const v = level >= 0 ? s.table[level]! : NaN;
      if (!Number.isFinite(v)) continue;
      values[j * w + i] = kind === "vel" ? v * KT_TO_MS : v;
      bytes[j * w + i] = Math.min(255, Math.max(1, QUANT[kind].enc(v)));
    }
  }
  return { grid: { w, h, data: Buffer.from(bytes).toString("base64") }, values };
}

/**
 * Where the debris signature and the couplet are: the strongest low-CC spot
 * inside echoes of 40 dBZ or more, and the strongest velocity difference
 * across about 2 km near it (or anywhere, when there's no signature).
 */
export function findFeatures(ref: Float32Array | null, vel: Float32Array | null, cc: Float32Array | null, w: number, h: number, res: number) {
  const points: Record<string, { x: number; y: number }> = {};
  const toKm = (i: number, j: number) => ({ x: Math.round((-(w * res) / 2 + (i + 0.5) * res) * 100) / 100, y: Math.round((-(h * res) / 2 + (j + 0.5) * res) * 100) / 100 });
  let tds: [number, number] | null = null;
  if (ref && cc) {
    // Score each cell by how many low-CC, high-reflectivity cells surround it (a debris ball, not one odd gate).
    const r = Math.max(1, Math.round(1 / res));
    let best = 0;
    for (let j = r; j < h - r; j++)
      for (let i = r; i < w - r; i++) {
        let n = 0;
        for (let dj = -r; dj <= r; dj++)
          for (let di = -r; di <= r; di++) {
            const k = (j + dj) * w + (i + di);
            if (cc[k]! < 0.8 && ref[k]! >= 40) n++;
          }
        if (n > best) [best, tds] = [n, [i, j]];
      }
    if (best < 3) tds = null;
  }
  if (tds) points.debris = toKm(...tds);
  if (vel) {
    const r = Math.max(1, Math.round(1 / res));
    let best = 0, at: [number, number] | null = null;
    for (let j = r; j < h - r; j++)
      for (let i = r; i < w - r; i++) {
        if (tds && Math.hypot(i - tds[0], j - tds[1]) * res > 6) continue;
        let lo = Infinity, hi = -Infinity;
        for (let dj = -r; dj <= r; dj++)
          for (let di = -r; di <= r; di++) {
            const v = vel[(j + dj) * w + (i + di)]!;
            if (Number.isFinite(v)) [lo, hi] = [Math.min(lo, v), Math.max(hi, v)];
          }
        // A couplet has strong flow both ways, not just a big difference from one side.
        const shear = lo < -8 && hi > 8 ? hi - lo : 0;
        if (shear > best) [best, at] = [shear, [i, j]];
      }
    if (at && best >= 30) points.couplet = toKm(...at);
  }
  if (ref) {
    let best = -Infinity, at: [number, number] = [0, 0];
    for (let k = 0; k < ref.length; k++) if (ref[k]! > best) [best, at] = [ref[k]!, [k % w, Math.floor(k / w)]];
    points.core = toKm(...at);
  }
  return points;
}

const MOMENTS: Record<"ref" | "vel" | "cc", Moment> = { ref: "REF", vel: "VEL", cc: "RHO" };

/** Downloads and decodes a case; products the volume doesn't have (CC before 2013) are left out. */
export async function loadCase(c: CaseSpec, fetchImpl: Fetch = fetch, log = console.log): Promise<CaseData> {
  const res = c.res ?? 0.25;
  const key = await findVolume(c.site, c.time, fetchImpl);
  const r = await fetchImpl(`${ARCHIVE}/${key}`);
  if (!r.ok) throw new Error(`Downloading ${key} failed: ${r.status}`);
  let file = new Uint8Array(await r.arrayBuffer());
  if (file[0] === 0x1f && file[1] === 0x8b) file = new Uint8Array(gunzipSync(file));
  const grids: CaseData["grids"] = {};
  const values: Partial<Record<"ref" | "vel" | "cc", Float32Array>> = {};
  let sweep: Sweep | null = null;
  for (const kind of ["ref", "vel", "cc"] as const) {
    const s = parseLevel2(file, MOMENTS[kind], 0.5).sweep;
    if (!s) continue;
    sweep ??= s;
    const g = grid(s, kind, c, res);
    grids[kind] = g.grid;
    values[kind] = g.values;
  }
  if (!sweep) throw new Error(`${key}: no 0.5° scan`);
  const w = Math.round(c.widthKm / res), h = Math.round(c.heightKm / res);
  const points = findFeatures(values.ref ?? null, values.vel ?? null, values.cc ?? null, w, h, res);
  const cosLat = Math.cos((c.lat * Math.PI) / 180);
  const radar = { x: (sweep.lon - c.lon) * KM_PER_DEG * cosLat, y: -(sweep.lat - c.lat) * KM_PER_DEG };
  const when = new Date(sweep.time);
  const label = new Intl.DateTimeFormat("en-US", { timeZone: c.zone, hour: "numeric", minute: "2-digit", timeZoneName: "short", month: "short", day: "numeric", year: "numeric" }).format(when);
  log(`Radar School case ${c.site} ${when.toISOString()} (${key}): ${Object.keys(grids).join(", ")}; found ${Object.keys(points).join(", ") || "nothing"}.`);
  return { site: c.site, place: c.place, time: when.toISOString(), label, widthKm: c.widthKm, heightKm: c.heightKm, res, radar, grids, points };
}
