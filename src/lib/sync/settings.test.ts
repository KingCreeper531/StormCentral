import { describe, expect, it } from "vitest";
import { applySettings, collect, fingerprint, MAX_SETTINGS_CHARS, SECTIONS, validateSettings, type SyncedSettings } from "./settings";

/** A device's local storage as a map. */
function device(entries: Record<string, unknown>) {
  const store = new Map<string, string>(Object.entries(entries).map(([k, v]) => [k, JSON.stringify(v)]));
  return { get: (k: string) => store.get(k) ?? null, set: (k: string, v: string) => void store.set(k, v), read: (k: string) => JSON.parse(store.get(k) ?? "null") };
}

const pc = () =>
  device({
    "stormcentral:v1": { state: { mode: "severe", location: { lat: 41, lon: -87, name: "Chicago", source: "gps" }, googleKey: "secret", theme: "light", units: { temp: "C" }, radar: { opacity: 0.6 } }, version: 1 },
    "stormcentral:map-style:v1": { state: { style: { basemap: "streets" }, presets: [{ id: "mp-1", name: "Mine", style: {} }] }, version: 1 },
    "stormcentral:alerts:v1": { state: { places: [{ id: "p1", name: "Home" }], rules: [], settings: { enabled: true, level: "warning" } }, version: 1 },
    "stormcentral:gis:v1": { state: { layers: [{ id: "a", url: "https://x.test/p.txt" }, { id: "b", url: null, fileName: "mine.kml" }] }, version: 1 },
    "stormcentral:broadcast:v1": { state: { name: "My WX", logo: "data:image/png;base64,AAAA", live: true, accent: "#ff0000" }, version: 1 },
  });

describe("collect", () => {
  it("takes the fields that travel and leaves the device's own behind", () => {
    const s = collect(pc().get);
    expect(s.v).toBe(1);
    expect(s.sections.app).toEqual({ theme: "light", units: { temp: "C" }, radar: { opacity: 0.6 } });
    expect(s.sections.mapStyle).toEqual({ style: { basemap: "streets" }, presets: [{ id: "mp-1", name: "Mine", style: {} }] });
    // Not whether this device notifies; not file layers; not the logo or the on-air switch.
    expect(s.sections.alerts).toEqual({ places: [{ id: "p1", name: "Home" }], rules: [], settings: { level: "warning" } });
    expect(s.sections.layers).toEqual({ layers: [{ id: "a", url: "https://x.test/p.txt" }] });
    expect(s.sections.broadcast).toEqual({ name: "My WX", accent: "#ff0000" });
    // Nothing stored yet: no section.
    expect(s.sections.pro).toBeUndefined();
  });

  it("skips damaged storage", () => {
    expect(collect((k) => (k === "stormcentral:v1" ? "{oops" : null)).sections).toEqual({});
  });
});

describe("applySettings", () => {
  it("lays the account's settings over the device's own, keeping what stays put", () => {
    const phone = device({
      "stormcentral:v1": { state: { mode: "daily", location: { lat: 35, lon: -97, name: "Norman", source: "gps" }, googleKey: "phone-key", theme: "dark" }, version: 1 },
      "stormcentral:alerts:v1": { state: { places: [], rules: [], settings: { enabled: false, level: "watch" } }, version: 1 },
      "stormcentral:gis:v1": { state: { layers: [{ id: "c", url: null, fileName: "phone.geojson" }] }, version: 1 },
      "stormcentral:broadcast:v1": { state: { name: "Phone", logo: "data:phone", live: false }, version: 1 },
    });
    const changed = applySettings(collect(pc().get), phone.get, phone.set);
    expect(changed.sort()).toEqual(["alerts", "app", "broadcast", "layers", "mapStyle"]);
    const app = phone.read("stormcentral:v1");
    expect(app.state).toMatchObject({ mode: "daily", googleKey: "phone-key", theme: "light", units: { temp: "C" } });
    expect(app.state.location.name).toBe("Norman");
    expect(app.version).toBe(1);
    // The phone's notification switch and file layers stay; the PC's link layers arrive.
    expect(phone.read("stormcentral:alerts:v1").state.settings).toEqual({ level: "warning", enabled: false });
    expect(phone.read("stormcentral:gis:v1").state.layers.map((l: { id: string }) => l.id)).toEqual(["c", "a"]);
    expect(phone.read("stormcentral:broadcast:v1").state).toMatchObject({ name: "My WX", logo: "data:phone", live: false });
    // A section the device had never stored is created with the store's version.
    expect(phone.read("stormcentral:map-style:v1")).toEqual({ state: { style: { basemap: "streets" }, presets: [{ id: "mp-1", name: "Mine", style: {} }] }, version: 1 });
  });

  it("changes nothing that's already the same", () => {
    const a = pc();
    expect(applySettings(collect(a.get), a.get, a.set)).toEqual([]);
  });
});

describe("validateSettings", () => {
  const good: SyncedSettings = { v: 1, sections: { app: { theme: "dark" } } };

  it("keeps the known sections", () => {
    expect(validateSettings({ ...good, sections: { ...good.sections, evil: { x: 1 } } })).toEqual(good);
  });

  it("refuses wrong versions, shapes and sizes", () => {
    expect(validateSettings(null)).toBeNull();
    expect(validateSettings({ v: 2, sections: {} })).toBeNull();
    expect(validateSettings({ v: 1, sections: { app: [1] } })).toBeNull();
    expect(validateSettings({ v: 1, sections: { app: { blob: "x".repeat(MAX_SETTINGS_CHARS) } } })).toBeNull();
  });

  it("covers every store section", () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(["app", "mapStyle", "palettes", "pro", "alerts", "addons", "layers", "broadcast"]);
  });
});

describe("fingerprint", () => {
  it("changes with the settings and nothing else", () => {
    const a = collect(pc().get);
    expect(fingerprint(a)).toBe(fingerprint(collect(pc().get)));
    expect(fingerprint({ ...a, sections: { ...a.sections, app: { theme: "dark" } } })).not.toBe(fingerprint(a));
    expect(fingerprint(a)).toMatch(/^[0-9a-f]{8}$/);
  });
});
