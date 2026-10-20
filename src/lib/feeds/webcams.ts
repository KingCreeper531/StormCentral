import type { WebcamRow, WebcamSource, WebcamsResponse } from "../webcams";
import { cached } from "./cache";
import type { Feed } from "./types";
import { upstreamJson } from "./upstream";

/**
 * Live cameras for the radar map, from four free public sources:
 *  - Caltrans CCTV (cwwp2.dot.ca.gov): ~3,000 California highway cameras,
 *    one JSON file per district; free to use in applications.
 *  - ALERTCalifornia (UC San Diego): ~1,300 wildfire cameras across the
 *    West; live feeds may be shown with the credit "ALERTCalifornia | UC San Diego".
 *  - USGS NIMS: cameras at stream gages nationwide (floods).
 *  - USGS AshCam: volcano cameras (Alaska, Cascades, Hawaii…).
 * Only the camera list goes through here; the pictures load straight from
 * each source, so this costs one small server run every ten minutes.
 */

const CALTRANS_DISTRICTS = Array.from({ length: 12 }, (_, i) => i + 1);
const HOUR = 3_600_000;
const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

function point(lat: unknown, lon: unknown): [number, number] | null {
  const y = typeof lat === "string" ? Number(lat) : lat;
  const x = typeof lon === "string" ? Number(lon) : lon;
  if (typeof y !== "number" || typeof x !== "number" || !Number.isFinite(y) || !Number.isFinite(x)) return null;
  // 0,0 and out-of-range positions are placeholders, not places.
  if ((y === 0 && x === 0) || Math.abs(y) > 90 || Math.abs(x) > 180) return null;
  return [round4(y), round4(x)];
}

// ── Caltrans ─────────────────────────────────────────────────────────────────
interface CaltransRaw {
  data?: {
    cctv?: {
      inService?: string;
      location?: { locationName?: string; nearbyPlace?: string; latitude?: string; longitude?: string };
      imageData?: { static?: { currentImageURL?: string } };
    };
  }[];
}

const CALTRANS_IMAGE = /^https:\/\/cwwp2\.dot\.ca\.gov\/data\/d(\d{1,2})\/cctv\/image\/([\w.-]+)\/\2\.jpg$/;

/** "I-110 : (196) Avenue 26 Off Ramp" → "I-110 · Avenue 26 Off Ramp". */
const caltransName = (name: string) =>
  name
    .replace(/\s*:\s*/, " · ")
    .replace(/\(\d+\)\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

export function parseCaltrans(raw: unknown): WebcamRow[] {
  const out: WebcamRow[] = [];
  for (const row of (raw as CaltransRaw)?.data ?? []) {
    const c = row.cctv;
    if (!c || c.inService !== "true") continue;
    const m = c.imageData?.static?.currentImageURL?.match(CALTRANS_IMAGE);
    const at = point(c.location?.latitude, c.location?.longitude);
    if (!m || !at) continue;
    const name = caltransName(c.location?.locationName ?? "") || c.location?.nearbyPlace?.trim() || "Caltrans camera";
    out.push(["caltrans", `${Number(m[1])}/${m[2]}`, at[0], at[1], name]);
  }
  return out;
}

// ── ALERTCalifornia ──────────────────────────────────────────────────────────
interface AlertCaRaw {
  features?: { geometry?: { coordinates?: unknown[] }; properties?: { id?: string; name?: string; last_frame_ts?: number } }[];
}

/** "Axis-AlabamaHills1" → "Alabama Hills 1" (most cameras have no name of their own). */
export function alertCaName(id: string): string {
  return id
    .replace(/^axis-/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .replace(/([0-9])([A-Za-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseAlertCa(raw: unknown, nowMs = Date.now()): WebcamRow[] {
  const out: WebcamRow[] = [];
  for (const f of (raw as AlertCaRaw)?.features ?? []) {
    const p = f.properties;
    const id = p?.id;
    if (!id || !/^[\w.-]+$/.test(id)) continue;
    // A camera that hasn't sent a picture for two hours is offline.
    if (typeof p.last_frame_ts !== "number" || nowMs - p.last_frame_ts * 1000 > 2 * HOUR) continue;
    const [lon, lat] = f.geometry?.coordinates ?? [];
    const at = point(lat, lon);
    if (!at) continue;
    out.push(["alertca", id, at[0], at[1], p.name?.trim() || alertCaName(id)]);
  }
  return out;
}

// ── USGS river cameras (NIMS) ────────────────────────────────────────────────
interface NimsRaw {
  camId?: string;
  camName?: string;
  stateAbrv?: string;
  lat?: string;
  lng?: string;
  hideCam?: boolean;
  newestImageDT?: string;
  smallDir?: string;
}

export function parseUsgsRiver(raw: unknown, nowMs = Date.now()): WebcamRow[] {
  const out: WebcamRow[] = [];
  for (const c of Array.isArray(raw) ? (raw as NimsRaw[]) : []) {
    const id = c.camId;
    if (!id || c.hideCam || !/^[\w.-]+$/.test(id)) continue;
    // webcamImage builds the 720 px picture's address from the id; skip cameras stored anywhere else.
    if (c.smallDir !== `https://usgs-nims-images.s3.amazonaws.com/720/${id}/`) continue;
    const newest = Date.parse(c.newestImageDT ?? "");
    if (!Number.isFinite(newest) || nowMs - newest > 6 * HOUR) continue;
    const at = point(c.lat, c.lng);
    if (!at) continue;
    const name = c.camName?.trim() || id.replace(/_/g, " ");
    out.push(["usgs-river", id, at[0], at[1], c.stateAbrv && !name.endsWith(c.stateAbrv) ? `${name}, ${c.stateAbrv}` : name]);
  }
  return out;
}

// ── USGS volcano cameras (AshCam) ────────────────────────────────────────────
interface AshCamRaw {
  webcams?: {
    webcamCode?: string;
    webcamName?: string;
    vName?: string | null;
    latitude?: number;
    longitude?: number;
    faaInd?: string;
    currentMediumImageUrl?: string | null;
    newestImage?: { imageTimestamp?: number } | unknown[];
  }[];
}

export function parseUsgsVolcano(raw: unknown, nowMs = Date.now()): WebcamRow[] {
  const out: WebcamRow[] = [];
  for (const w of (raw as AshCamRaw)?.webcams ?? []) {
    const code = w.webcamCode;
    // FAA-owned cameras are listed too; those need the FAA's own agreement, so they stay out.
    if (!code || !/^[\w.-]+$/.test(code) || w.faaInd === "Y" || !w.currentMediumImageUrl) continue;
    const ts = Array.isArray(w.newestImage) ? undefined : w.newestImage?.imageTimestamp;
    if (typeof ts !== "number" || nowMs - ts * 1000 > 6 * HOUR) continue;
    const at = point(w.latitude, w.longitude);
    if (!at) continue;
    const name = w.webcamName?.trim() || code;
    out.push(["usgs-volcano", code, at[0], at[1], w.vName && !name.includes(w.vName) ? `${name} (${w.vName})` : name]);
  }
  return out;
}

// ── Feed ─────────────────────────────────────────────────────────────────────
const LOADERS: Record<WebcamSource, () => Promise<WebcamRow[]>> = {
  // Caltrans rewrites its lists every few days; the pictures themselves update every 2 minutes.
  caltrans: () =>
    cached("webcams:caltrans", 6 * HOUR, async () => {
      const lists = await Promise.allSettled(
        CALTRANS_DISTRICTS.map((d) => {
          const dd = String(d).padStart(2, "0");
          return upstreamJson(`https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${dd}.json`, { timeoutMs: 20_000 }).then(parseCaltrans);
        }),
      );
      const ok = lists.filter((r): r is PromiseFulfilledResult<WebcamRow[]> => r.status === "fulfilled");
      if (!ok.length) throw (lists[0] as PromiseRejectedResult).reason;
      return ok.flatMap((r) => r.value);
    }),
  alertca: () =>
    cached("webcams:alertca", 10 * 60_000, async () =>
      parseAlertCa(await upstreamJson("https://cameras.alertcalifornia.org/public-camera-data/all_cameras-v3.json", { timeoutMs: 20_000 })),
    ),
  "usgs-river": () =>
    cached("webcams:usgs-river", 30 * 60_000, async () =>
      parseUsgsRiver(await upstreamJson("https://api.waterdata.usgs.gov/nims/v0/cameras", { timeoutMs: 20_000 })),
    ),
  "usgs-volcano": () =>
    cached("webcams:usgs-volcano", 30 * 60_000, async () =>
      parseUsgsVolcano(await upstreamJson("https://volcview.wr.usgs.gov/ashcam-api/webcamApi/webcams", { timeoutMs: 20_000 })),
    ),
};

export const webcamsFeed: Feed<WebcamsResponse> = {
  path: "/api/webcams",
  maxAge: 600,
  async load() {
    const ids = Object.keys(LOADERS) as WebcamSource[];
    const results = await Promise.allSettled(ids.map((id) => LOADERS[id]()));
    const cams: WebcamRow[] = [];
    const unavailable: WebcamSource[] = [];
    results.forEach((r, i) => (r.status === "fulfilled" ? cams.push(...r.value) : unavailable.push(ids[i]!)));
    if (!cams.length && unavailable.length) throw (results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason;
    return { cams, unavailable, updated: new Date().toISOString() };
  },
};
