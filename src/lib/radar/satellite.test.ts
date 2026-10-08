import { describe, expect, it } from "vitest";
import {
  MAX_SLOTS,
  nearestSlot,
  pickSatellite,
  satelliteLabel,
  satelliteLayerName,
  satelliteSlot,
  satelliteTileUrl,
  slotsFor,
} from "./satellite";

const at = (iso: string) => Date.parse(iso);

describe("satelliteSlot", () => {
  it("floors (t − latency) to a 10-minute boundary", () => {
    expect(satelliteSlot(at("2026-10-07T14:43:59Z"))).toBe(at("2026-10-07T14:20:00Z"));
    expect(satelliteSlot(at("2026-10-07T14:40:00Z"))).toBe(at("2026-10-07T14:20:00Z"));
    expect(satelliteSlot(at("2026-10-07T14:39:59Z"))).toBe(at("2026-10-07T14:10:00Z"));
    // Crosses midnight UTC.
    expect(satelliteSlot(at("2026-10-08T00:05:00Z"))).toBe(at("2026-10-07T23:40:00Z"));
  });

  it("honours a custom latency", () => {
    expect(satelliteSlot(at("2026-10-07T14:43:00Z"), 0)).toBe(at("2026-10-07T14:40:00Z"));
    expect(satelliteSlot(at("2026-10-07T14:43:00Z"), 30)).toBe(at("2026-10-07T14:10:00Z"));
  });
});

describe("slotsFor", () => {
  it("dedupes a 12-frame, 5-minute loop to 6 images, oldest first", () => {
    const end = at("2026-10-07T14:57:00Z"); // scans at :02, :07 … :57
    const times = Array.from({ length: 12 }, (_, i) => end - (11 - i) * 300_000);
    const slots = slotsFor(times);
    expect(slots).toHaveLength(6);
    expect(slots[0]).toBe(at("2026-10-07T13:40:00Z"));
    expect(slots.at(-1)).toBe(at("2026-10-07T14:30:00Z"));
    expect([...slots].sort((a, b) => a - b)).toEqual(slots);
  });

  it("keeps only the newest slots, ignores junk and order", () => {
    const end = at("2026-10-07T18:00:00Z");
    const times = Array.from({ length: 20 }, (_, i) => end - i * 600_000); // newest first
    const slots = slotsFor([...times, NaN]);
    expect(slots).toHaveLength(MAX_SLOTS);
    expect(slots.at(-1)).toBe(satelliteSlot(end));
    expect(slotsFor([])).toEqual([]);
  });
});

describe("nearestSlot", () => {
  it("snaps to the closest held slot, older on a tie", () => {
    const s = [0, 600_000, 1_200_000];
    expect(nearestSlot(s, 600_000)).toBe(600_000);
    expect(nearestSlot(s, -5_000_000)).toBe(0);
    expect(nearestSlot(s, 9_000_000)).toBe(1_200_000);
    expect(nearestSlot([0, 1_200_000], 600_000)).toBe(0);
    expect(nearestSlot([], 0)).toBeNull();
  });
});

describe("satellite URLs", () => {
  it("names the GIBS layers", () => {
    expect(satelliteLayerName("infrared", "east")).toBe("GOES-East_ABI_Band13_Clean_Infrared");
    expect(satelliteLayerName("infrared", "west")).toBe("GOES-West_ABI_Band13_Clean_Infrared");
    expect(satelliteLayerName("visible", "east")).toBe("GOES-East_ABI_Band2_Red_Visible_1km");
    expect(satelliteLayerName("visible", "west")).toBe("GOES-West_ABI_Band2_Red_Visible_1km");
  });

  it("builds a WMS GetMap template MapLibre can fill in", () => {
    const url = satelliteTileUrl("infrared", "west", at("2026-10-07T14:20:00Z"));
    expect(url.startsWith("https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi?")).toBe(true);
    // The placeholder must survive verbatim (not percent-encoded).
    expect(url).toContain("BBOX={bbox-epsg-3857}");
    expect(url).toContain("TIME=2026-10-07T14:20:00Z");
    const q = new URLSearchParams(url.split("?")[1]);
    expect(q.get("SERVICE")).toBe("WMS");
    expect(q.get("REQUEST")).toBe("GetMap");
    expect(q.get("VERSION")).toBe("1.3.0");
    expect(q.get("LAYERS")).toBe("GOES-West_ABI_Band13_Clean_Infrared");
    expect(q.get("STYLES")).toBe("");
    expect(q.get("FORMAT")).toBe("image/png");
    expect(q.get("TRANSPARENT")).toBe("TRUE");
    expect(q.get("CRS")).toBe("EPSG:3857");
    expect(q.get("WIDTH")).toBe("256");
    expect(q.get("HEIGHT")).toBe("256");
  });
});

describe("pickSatellite", () => {
  it("chooses East or West from the view centre", () => {
    expect(pickSatellite(-97.5)).toBe("east"); // Oklahoma
    expect(pickSatellite(-80)).toBe("east"); // Florida
    expect(pickSatellite(-114)).toBe("east");
    expect(pickSatellite(-116)).toBe("west");
    expect(pickSatellite(-122.4)).toBe("west"); // San Francisco
    expect(pickSatellite(-157.8)).toBe("west"); // Honolulu
    expect(pickSatellite(144.8)).toBe("west"); // Guam, across the date line
    expect(pickSatellite(-122.4 + 360)).toBe("west"); // unwrapped longitude
    expect(pickSatellite(NaN)).toBe("east");
  });

  it("holds the current choice near the line", () => {
    expect(pickSatellite(-116, "east")).toBe("east");
    expect(pickSatellite(-118, "east")).toBe("west");
    expect(pickSatellite(-114, "west")).toBe("west");
    expect(pickSatellite(-112, "west")).toBe("east");
    expect(pickSatellite(NaN, "west")).toBe("west");
  });
});

describe("satelliteLabel", () => {
  it("names the satellite, band and image time", () => {
    const t = at("2026-10-07T19:20:00Z");
    const label = satelliteLabel("infrared", t, "America/Chicago", "east");
    expect(label.startsWith("GOES-East infrared, ")).toBe(true);
    expect(label).toMatch(/2:20/);
    expect(satelliteLabel("visible", t, "UTC", "west")).toMatch(/^GOES-West visible, .*7:20/);
    expect(satelliteLabel("visible", t, "UTC")).toMatch(/^GOES visible, /);
  });
});
