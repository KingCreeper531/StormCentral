import type { KpPoint, SpaceWeatherResponse } from "../api/types";
import { parseKp } from "./parse";
import { cached } from "./cache";
import type { Feed } from "./types";
import { upstreamJson } from "./upstream";

const SWPC = "https://services.swpc.noaa.gov/products";

/** Observed and forecast planetary Kp (NOAA SWPC). */
export const spaceWeatherFeed: Feed<SpaceWeatherResponse> = {
  path: "/api/space-weather",
  maxAge: 900,
  load: () =>
    cached("swpc:kp", 15 * 60_000, async () => {
      const [observed, forecast] = await Promise.allSettled([
        upstreamJson(`${SWPC}/noaa-planetary-k-index.json`),
        upstreamJson(`${SWPC}/noaa-planetary-k-index-forecast.json`),
      ]);
      const obs = observed.status === "fulfilled" ? parseKp(observed.value, "observed") : [];
      const fc = forecast.status === "fulfilled" ? parseKp(forecast.value, "predicted") : [];
      if (!obs.length && !fc.length) throw new Error("SWPC Kp feeds unavailable");

      // Merge on time; the forecast file also contains recent observed rows.
      const byTime = new Map<string, KpPoint>();
      for (const p of [...obs, ...fc]) if (!byTime.has(p.time) || p.kind === "observed") byTime.set(p.time, p);
      const series = [...byTime.values()].sort((a, b) => a.time.localeCompare(b.time));
      const now = Date.now();
      const current = series.filter((p) => Date.parse(p.time) <= now).at(-1) ?? null;
      const next = series.filter((p) => Date.parse(p.time) > now && Date.parse(p.time) <= now + 86_400_000);
      return {
        current,
        series: series.filter((p) => Date.parse(p.time) >= now - 3 * 86_400_000),
        maxNext24h: next.length ? Math.max(...next.map((p) => p.kp)) : null,
      };
    }),
};
