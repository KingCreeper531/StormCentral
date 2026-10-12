import { HttpError } from "../api/http";
import { buildClimate, rankStations, type AcisStation, type ClimateTable } from "../climate";
import { cached } from "./cache";
import type { Feed } from "./types";
import { badParams, parseLatLon, upstreamJson } from "./upstream";

const ACIS = "https://data.rcc-acis.org";

export type ClimateResponse = ClimateTable;

interface AcisReply {
  error?: string;
  meta?: { name?: string; valid_daterange?: [string, string][] };
  smry?: unknown;
  data?: unknown;
}

async function acis<T extends AcisReply>(endpoint: "StnMeta" | "StnData", params: object): Promise<T> {
  const r = await upstreamJson<T>(`${ACIS}/${endpoint}?params=${encodeURIComponent(JSON.stringify(params))}`, { timeoutMs: 20_000 });
  // ACIS reports bad ids and empty results in a 200 response.
  if (r?.error) throw new HttpError(`ACIS: ${r.error}`, 404);
  return r;
}

const dly = { interval: "dly", duration: "dly", groupby: ["year", "01-01", "12-31"], smry_only: 1 };
const RECORD_ELEMS = [
  { name: "maxt", ...dly, smry: { reduce: "max", add: "date" } },
  { name: "mint", ...dly, smry: { reduce: "min", add: "date" } },
  { name: "pcpn", ...dly, smry: { reduce: "max", add: "date" } },
];

/** Stations with a 30-year record that report now, within ~90 km (then ~180 km). */
async function findStations(lat: number, lon: number): Promise<AcisStation[]> {
  for (const d of [0.8, 1.6]) {
    const dLon = d / Math.max(0.3, Math.cos((lat * Math.PI) / 180));
    const bbox = [lon - dLon, lat - d, lon + dLon, lat + d].map((v) => v.toFixed(2)).join(",");
    const raw = await acis("StnMeta", { bbox, elems: "maxt", meta: "name,sids,ll,valid_daterange", sdate: "1991-01-01", edate: "2020-12-31" }).catch((err) => {
      if (err instanceof HttpError && err.status === 404) return { meta: [] };
      throw err;
    });
    const ranked = rankStations(raw, { lat, lon }, Date.now());
    if (ranked.length) return ranked;
  }
  throw new HttpError("No long-record weather station near this location (US only)", 404);
}

/**
 * `lat` & `lon`: daily normals and records from the best nearby station (US).
 * The stations near a grid cell are cached for a month, the table for a week.
 */
export const climateFeed: Feed<ClimateResponse> = {
  path: "/api/climate",
  maxAge: 21_600,
  async load(sp) {
    const p = parseLatLon(sp);
    if (!p) throw badParams("lat/lon required");
    const lat = Math.round(p.lat * 4) / 4;
    const lon = Math.round(p.lon * 4) / 4;
    const stations = await cached(`climate-stations:${lat}:${lon}`, 30 * 86_400_000, () => findStations(lat, lon), { persist: true });
    const best = stations[0]!;
    return cached(
      `climate:${lat}:${lon}`,
      7 * 86_400_000,
      async () => {
        // A threaded record ("PITthr") joins a city's old downtown and newer airport stations: records back to the 1800s.
        // Only some airports carry one (PIT does, nearby AGC doesn't), so the nearest few are tried.
        let sid = best.sid;
        let station = best;
        let records: AcisReply | null = null;
        for (const s of stations.filter((x) => x.faa && x.distanceKm < 60).slice(0, 3)) {
          records = await acis("StnData", { sid: `${s.faa}thr`, sdate: "por", edate: "por", elems: RECORD_ELEMS, meta: "name,valid_daterange" }).catch(() => null);
          if (records) {
            sid = `${s.faa}thr`;
            station = s;
            break;
          }
        }
        records ??= await acis("StnData", { sid, sdate: "por", edate: "por", elems: RECORD_ELEMS, meta: "name,valid_daterange" });
        // Normals for a leap year give all 366 days.
        const normals = await acis("StnData", {
          sid,
          sdate: "2024-01-01",
          edate: "2024-12-31",
          elems: [
            { name: "maxt", normal: "1" },
            { name: "mint", normal: "1" },
            { name: "pcpn", normal: "1" },
          ],
        }).catch(() => ({ data: [] }));
        const name = records.meta?.name;
        return buildClimate(records, normals, station, sid === station.sid ? undefined : name, records.meta?.valid_daterange?.[0]);
      },
      { persist: true },
    );
  },
};
