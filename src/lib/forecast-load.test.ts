import { afterEach, describe, expect, it, vi } from "vitest";
import { keyTag, loadForecast } from "./forecast-load";

/** An Open-Meteo forecast body with 48 hourly temperatures (or nulls). */
function body(withTemps: boolean) {
  const now = Math.floor(Date.now() / 3_600_000) * 3600;
  const time = Array.from({ length: 48 }, (_, i) => now + i * 3600);
  return {
    latitude: 35.2,
    longitude: -97.4,
    elevation: 350,
    timezone: "America/Chicago",
    utc_offset_seconds: -18000,
    current: { time: now, temperature_2m: 20 },
    hourly: { time, temperature_2m: time.map(() => (withTemps ? 20 : null)) },
    daily: { time: [now], temperature_2m_max: [25] },
  };
}

function mockFetch(handler: (url: string) => { status?: number; json: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const r = handler(String(url));
      return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("loadForecast", () => {
  it("asks Open-Meteo for the chosen model", async () => {
    const urls: string[] = [];
    mockFetch((url) => (urls.push(url), { json: body(true) }));
    const f = await loadForecast(35.2, -97.4, "ecmwf", "", undefined);
    expect(urls[0]).toContain("models=ecmwf_ifs025");
    expect(f.source).toBe("ecmwf");
    expect(f.notice).toBeUndefined();
  });

  it("falls back to the best match, with a notice, when a model has nothing here", async () => {
    mockFetch((url) => ({ json: body(!url.includes("models=")) }));
    const f = await loadForecast(35.2, -97.4, "nbm", "", undefined);
    expect(f.source).toBeUndefined();
    expect(f.notice).toMatch(/NWS National Blend has no forecast for this location/);
  });

  it("asks for a key before using Google, and reports a rejected key", async () => {
    mockFetch((url) => (url.includes("googleapis") ? { status: 400, json: { error: { message: "API key not valid. Please pass a valid API key." } } } : { json: body(true) }));
    expect((await loadForecast(35.2, -97.4, "google", "", undefined)).notice).toMatch(/Add your Google Weather API key/);
    const f = await loadForecast(35.2, -97.4, "google", "bad-key", undefined);
    expect(f.notice).toBe("Google: Google says this API key isn't valid.");
    expect(f.current.temp).toBe(20);
  });

  it("tags keys without exposing them", () => {
    expect(keyTag("")).toBe("none");
    expect(keyTag("AIzaSecret")).not.toContain("Secret");
    expect(keyTag("a")).not.toBe(keyTag("b"));
  });
});
