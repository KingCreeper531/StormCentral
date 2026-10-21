import { describe, expect, it } from "vitest";
import type { AppLocation } from "@/store/app-store";
import { urlLocation } from "./use-url-sync";

// Followed by GPS: full precision; the address bar holds it to 4 decimals.
const here: AppLocation = { lat: 35.222641, lon: -97.439517, name: "Norman", source: "gps" };
const url = (q: string) => new URLSearchParams(q);

describe("urlLocation", () => {
  it("keeps the persisted place (and its source) when the URL is that place", () => {
    expect(urlLocation(url("mode=daily&lat=35.2226&lon=-97.4395&name=Norman"), here)).toBeNull();
    expect(urlLocation(url("lat=0.0000&lon=0.0000"), { ...here, lat: -0.00001, lon: 0.00002 })).toBeNull();
  });

  it("opens a shared link to somewhere else", () => {
    expect(urlLocation(url("lat=41.8781&lon=-87.6298&name=Chicago"), here)).toEqual({ lat: 41.8781, lon: -87.6298, name: "Chicago", source: "url" });
    expect(urlLocation(url("lat=35.2227&lon=-97.4395"), here)).toEqual({ lat: 35.2227, lon: -97.4395, name: "35.22, -97.44", source: "url" });
  });

  it("ignores missing or out-of-range coordinates", () => {
    expect(urlLocation(url("mode=daily"), here)).toBeNull();
    expect(urlLocation(url("lat=&lon="), here)).toBeNull();
    expect(urlLocation(url("lat=95&lon=10"), here)).toBeNull();
  });
});
