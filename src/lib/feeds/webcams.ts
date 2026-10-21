import { WEBCAM_SOURCE_IDS, WEBCAM_SOURCES, type WebcamRow, type WebcamSource, type WebcamsResponse } from "../webcams";
import { cached } from "./cache";
import type { Feed } from "./types";
import { upstreamJson } from "./upstream";

/**
 * Live cameras for the radar map, from free public sources:
 *  - Caltrans CCTV (cwwp2.dot.ca.gov): ~3,000 California highway cameras,
 *    one JSON file per district; free to use in applications.
 *  - ALERTCalifornia (UC San Diego): ~1,300 wildfire cameras across the
 *    West; live feeds may be shown with the credit "ALERTCalifornia | UC San Diego".
 *  - USGS NIMS: cameras at stream gages nationwide (floods).
 *  - USGS AshCam: volcano cameras (Alaska, Cascades, Hawaii…).
 *  - Iowa DOT and WSDOT highway cameras (their ArcGIS layers), once each
 *    agency allows it (lib/webcams: `approved`).
 * Only the camera list goes through here; the pictures load straight from
 * each source, so this costs one small server run every ten minutes.
 */

const CALTRANS_DISTRICTS = Array.from({ length: 12 }, (_, i) => i + 1);
const HOUR = 3_600_000;
const round4 = (v: number) => Math.round(v * 1e4) / 1e4;
/** Some agencies name cameras in capitals ("SWAN CREEK AT SWAN CREEK"); those read better in title case. */
const unshout = (s: string) => (s === s.toUpperCase() && /[A-Z]{3}/.test(s) ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s);

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
    const name = unshout(c.camName?.trim() || id.replace(/_/g, " "));
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
    // "CVO St. Helens (…)" already says which volcano; "Mount St. Helens" needn't be added.
    const volcano = w.vName?.replace(/^(mount|mt\.?)\s+/i, "");
    out.push(["usgs-volcano", code, at[0], at[1], volcano && !name.includes(volcano) ? `${name} (${w.vName})` : name]);
  }
  return out;
}

// ── State DOTs (ArcGIS layers) ───────────────────────────────────────────────
/** Every feature of an ArcGIS layer query, a page at a time (servers cap a page, often at 1,000 or 2,000). */
async function arcgisFeatures<F>(query: string, pick: (page: unknown) => F[], pageSize = 2000, maxPages = 10): Promise<F[]> {
  const out: F[] = [];
  for (let page = 0; page < maxPages; page++) {
    const rows = pick(await upstreamJson(`${query}&resultRecordCount=${pageSize}&resultOffset=${page * pageSize}`, { timeoutMs: 30_000 }));
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

interface IowaFeature {
  geometry?: { coordinates?: unknown[] };
  properties?: {
    ImageName?: string;
    Desc_?: string;
    ImageURL?: string;
    ORG?: string;
    UpdateDate?: unknown;
    UpdateTime?: unknown;
    UTCoffset?: unknown;
    latitude?: unknown;
    longitude?: unknown;
  };
}

const IOWA_IMAGE = /^https:\/\/atmsqf\.iowadot\.gov\/SNAPSHOTS\/PUBLIC\/([A-Za-z]+\/[\w.-]+\.jpe?g)$/i;
/** How far behind the layer's latest refresh a camera may be before it counts as offline. */
const IOWA_STALE_MS = 3 * 3_600_000;

/** When Iowa DOT last saw the camera working: UpdateDate 20261021, UpdateTime 64210 (06:42:10), UTCoffset -500 (UTC-5). */
function iowaSeen(p: NonNullable<IowaFeature["properties"]>): number | null {
  const date = String(p.UpdateDate ?? "").match(/^(\d{4})(\d{2})(\d{2})$/);
  const time = String(p.UpdateTime ?? "").match(/^\d{1,6}$/) ? String(p.UpdateTime).padStart(6, "0").match(/^(\d{2})(\d{2})(\d{2})$/) : null;
  if (!date || !time) return null;
  const offset = Number(p.UTCoffset);
  const offsetMin = Number.isFinite(offset) ? Math.trunc(offset / 100) * 60 + (offset % 100) : 0;
  const local = Date.UTC(+date[1]!, +date[2]! - 1, +date[3]!, +time[1]!, +time[2]!, +time[3]!);
  return Number.isFinite(local) ? local - offsetMin * 60_000 : null;
}

/**
 * Iowa DOT's "Traffic Cameras" layer (GeoJSON): one feature per camera view, Iowa DOT's own cameras only.
 * The layer is rewritten in one batch, and a camera that stopped sending pictures keeps its old UpdateDate/UpdateTime
 * (its picture then 404s), so cameras well behind the newest one are left out. Measured against the layer's own
 * newest time, not the clock, so a late batch never empties the map.
 */
export function parseIowa(features: unknown): WebcamRow[] {
  const list = (Array.isArray(features) ? (features as IowaFeature[]) : []).filter((f) => f.properties?.ORG === "IADOT");
  const seenAt = list.map((f) => iowaSeen(f.properties!));
  const newest = Math.max(...seenAt.filter((t): t is number => t !== null));
  const out: WebcamRow[] = [];
  const seen = new Set<string>();
  for (const [i, f] of list.entries()) {
    const p = f.properties!;
    const m = p.ImageURL?.trim().match(IOWA_IMAGE);
    if (!m || seen.has(m[1]!)) continue;
    if (seenAt[i] !== null && seenAt[i]! < newest - IOWA_STALE_MS) continue;
    const [lon, lat] = f.geometry?.coordinates ?? [p.longitude, p.latitude];
    const at = point(lat, lon);
    if (!at) continue;
    seen.add(m[1]!);
    out.push(["iowa", m[1]!, at[0], at[1], (p.ImageName || p.Desc_ || "Iowa DOT camera").trim()]);
  }
  return out;
}

interface WsdotFeature {
  geometry?: { x?: unknown; y?: unknown };
  attributes?: { CameraTitle?: string; ImageURL?: string };
}

const WSDOT_IMAGE = /^https:\/\/images\.wsdot\.wa\.gov\/((?:[\w-]+\/)+[\w.-]+\.jpe?g)$/i;

/** WSDOT's camera layer (Esri JSON): WSDOT's own cameras only (it also lists some of Oregon's). */
export function parseWsdot(features: unknown): WebcamRow[] {
  const out: WebcamRow[] = [];
  const seen = new Set<string>();
  for (const f of Array.isArray(features) ? (features as WsdotFeature[]) : []) {
    const m = f.attributes?.ImageURL?.trim().match(WSDOT_IMAGE);
    if (!m || seen.has(m[1]!)) continue;
    const at = point(f.geometry?.y, f.geometry?.x);
    if (!at) continue;
    seen.add(m[1]!);
    out.push(["wsdot", m[1]!, at[0], at[1], f.attributes?.CameraTitle?.trim() || "WSDOT camera"]);
  }
  return out;
}

const IOWA_LAYER =
  "https://services.arcgis.com/8lRhdTsQyJpO52F1/arcgis/rest/services/Traffic_Cameras_View/FeatureServer/0/query?where=1%3D1&outFields=ImageName,Desc_,ImageURL,ORG,UpdateDate,UpdateTime,UTCoffset&outSR=4326&f=geojson";
const WSDOT_LAYER =
  "https://data.wsdot.wa.gov/arcgis/rest/services/TravelInformation/TravelInfoCamerasWeather/FeatureServer/0/query?where=1%3D1&outFields=CameraTitle,ImageURL&outSR=4326&f=json";

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
  // The camera lists, at most every 30 minutes (as promised when asking each agency).
  iowa: () => cached("webcams:iowa", 30 * 60_000, async () => parseIowa(await arcgisFeatures(IOWA_LAYER, (j) => (j as { features?: unknown[] })?.features ?? []))),
  wsdot: () => cached("webcams:wsdot", 30 * 60_000, async () => parseWsdot(await arcgisFeatures(WSDOT_LAYER, (j) => (j as { features?: unknown[] })?.features ?? []))),
};

/** One source's cameras, whether or not it's approved yet (for checks against the live source). */
export const loadWebcamSource = (id: WebcamSource) => LOADERS[id]();

export const webcamsFeed: Feed<WebcamsResponse> = {
  path: "/api/webcams",
  maxAge: 600,
  async load() {
    // Sources still waiting for the owner's permission aren't fetched at all.
    const ids = WEBCAM_SOURCE_IDS.filter((id) => WEBCAM_SOURCES[id].approved);
    const results = await Promise.allSettled(ids.map((id) => LOADERS[id]()));
    const cams: WebcamRow[] = [];
    const unavailable: WebcamSource[] = [];
    results.forEach((r, i) => (r.status === "fulfilled" ? cams.push(...r.value) : unavailable.push(ids[i]!)));
    if (!cams.length && unavailable.length) throw (results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason;
    return { cams, unavailable, updated: new Date().toISOString() };
  },
};
