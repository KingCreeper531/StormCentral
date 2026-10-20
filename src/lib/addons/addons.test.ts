import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addonSearchUrl, resolveManifest } from "./github";
import { FEATURED_PLUGINS, FEATURED_THEMES } from "./featured";
import { AddonError, expandTileUrl, parseAddon, themeVars, type PluginAddon, type RasterLayer } from "./manifest";
import { newerVersion, withBundled } from "@/store/addons-store";

const src = { id: "x", homepage: null };

describe("resolveManifest", () => {
  it("handles owner/repo and repository links", () => {
    expect(resolveManifest("a/b").raw).toBe("https://raw.githubusercontent.com/a/b/HEAD/stormcentral.json");
    expect(resolveManifest("https://github.com/a/b.git").raw).toBe("https://raw.githubusercontent.com/a/b/HEAD/stormcentral.json");
    expect(resolveManifest("github.com/a/b/").homepage).toBe("https://github.com/a/b");
  });
  it("handles folder, file, raw and gist links", () => {
    expect(resolveManifest("https://github.com/a/b/tree/main/themes/nord").raw).toBe("https://raw.githubusercontent.com/a/b/main/themes/nord/stormcentral.json");
    expect(resolveManifest("https://github.com/a/b/blob/dev/x.json").raw).toBe("https://raw.githubusercontent.com/a/b/dev/x.json");
    expect(resolveManifest("https://raw.githubusercontent.com/a/b/main/x.json").raw).toBe("https://raw.githubusercontent.com/a/b/main/x.json");
    expect(resolveManifest("https://gist.github.com/u/abc123").raw).toBe("https://gist.githubusercontent.com/u/abc123/raw/stormcentral.json");
  });
  it("refuses anything off GitHub", () => {
    expect(() => resolveManifest("https://evil.example/a/b")).toThrow(AddonError);
    expect(() => resolveManifest("javascript:alert(1)")).toThrow(AddonError);
  });
});

describe("addonSearchUrl", () => {
  it("searches the topic and includes forks, which GitHub leaves out by default", () => {
    const url = new URL(addonSearchUrl("theme"));
    expect(url.origin + url.pathname).toBe("https://api.github.com/search/repositories");
    expect(url.searchParams.get("q")).toBe("topic:stormcentral-theme fork:true");
    expect(new URL(addonSearchUrl("plugin")).searchParams.get("q")).toBe("topic:stormcentral-plugin fork:true");
  });
});

describe("parseAddon", () => {
  it("keeps only hex colours in known slots", () => {
    const t = parseAddon({ type: "theme", name: "T", colors: { canvas: "#000", ink: "red; background:url(x)", bogus: "#fff" } }, src);
    expect(t.type === "theme" && t.colors).toEqual({ canvas: "#000" });
    expect(themeVars(t as never)).toEqual({ "--color-canvas": "#000" });
  });
  it("validates plugin layers", () => {
    const p = parseAddon(
      {
        type: "plugin",
        name: "P",
        layers: [
          { type: "raster", tiles: ["https://t.example/{z}/{x}/{y}.png", "http://insecure/{z}/{x}/{y}.png"] },
          { type: "geojson", url: "https://d.example/a.geojson", color: "nope" },
        ],
      },
      src,
    );
    expect(p.type).toBe("plugin");
    if (p.type !== "plugin") return;
    expect(p.layers[0]).toMatchObject({ kind: "raster", tiles: ["https://t.example/{z}/{x}/{y}.png"] });
    expect(p.layers[1]).toMatchObject({ kind: "geojson", color: "#5b9cf6" });
  });
  it("rejects bad manifests with a reason", () => {
    expect(() => parseAddon({ type: "plugin", name: "P", layers: [{ type: "raster", tiles: ["https://x.example/a.png"] }] }, src)).toThrow(/tile URL/);
    expect(() => parseAddon({ name: "X" }, src)).toThrow(AddonError);
    expect(() => parseAddon([], src)).toThrow(AddonError);
  });
  it("accepts the bundled examples", () => {
    const dirs = ["themes", "plugins"].flatMap((kind) => readdirSync(`examples/addons/${kind}`).map((d) => `${kind}/${d}`));
    for (const f of dirs) {
      const json = JSON.parse(readFileSync(`examples/addons/${f}/stormcentral.json`, "utf8"));
      expect(() => parseAddon(json, src), f).not.toThrow();
    }
    // Every example is in the in-app Featured list.
    expect(FEATURED_THEMES.length + FEATURED_PLUGINS.length).toBe(dirs.length);
  });

  it("lets a vivid-sky theme follow the sun with the built-in colours", () => {
    const t = parseAddon({ type: "theme", name: "Sky", base: "auto", sky: "vivid", colors: {} }, src);
    expect(t).toMatchObject({ type: "theme", sky: "vivid", followSun: true, colors: {} });
    expect(() => parseAddon({ type: "theme", name: "Plain", colors: {} }, src)).toThrow(AddonError);
  });

  it("accepts WMTS {z}/{y}/{x} order and fills date tokens", () => {
    const p = parseAddon({ type: "plugin", name: "P", layers: [{ type: "raster", tiles: ["https://g.example/{date}/{z}/{y}/{x}.jpg"], visible: false }] }, src);
    expect(p.type === "plugin" && p.layers[0]?.visible).toBe(false);
    const now = Date.parse("2026-10-12T05:00:00Z");
    expect(expandTileUrl("https://g.example/{date}/{date-2}/{z}", now)).toBe("https://g.example/2026-10-11/2026-10-10/{z}");
  });
});

describe("raster plugin placement", () => {
  const raster = (extra: Record<string, unknown>) =>
    parseAddon({ type: "plugin", name: "P", layers: [{ type: "raster", tiles: ["https://t.example/{z}/{x}/{y}.png"], ...extra }] }, src) as PluginAddon;

  it("puts layers over the radar unless they ask to go under it", () => {
    expect((raster({}).layers[0] as RasterLayer).position).toBe("above-radar");
    expect((raster({ position: "below-radar" }).layers[0] as RasterLayer).position).toBe("below-radar");
    expect((raster({ position: "on-top-of-everything" }).layers[0] as RasterLayer).position).toBe("above-radar");
  });

  it("keeps the Earth-from-space imagery under the radar", () => {
    const earth = FEATURED_PLUGINS.find((p) => p.id.includes("/earth-views/"))!;
    expect(earth.layers.map((l) => l.kind === "raster" && l.position)).toEqual(["below-radar", "below-radar", "below-radar"]);
  });

  it("compares versions numerically", () => {
    expect(newerVersion("1.10.0", "1.9.2")).toBe(true);
    expect(newerVersion("1.1.0", "1.1")).toBe(false);
    expect(newerVersion("1.0.0", null)).toBe(true);
    expect(newerVersion(null, "1.0.0")).toBe(false);
  });

  it("updates a bundled plugin installed from an older app", () => {
    const earth = FEATURED_PLUGINS.find((p) => p.id.includes("/earth-views/"))!;
    const old: PluginAddon = { ...earth, version: "1.0.0", layers: earth.layers.map((l) => (l.kind === "raster" ? { ...l, position: "above-radar" as const } : l)) };
    expect(withBundled(old).layers.every((l) => l.kind === "raster" && l.position === "below-radar")).toBe(true);
    // Same or newer than the bundled copy (installed by link from GitHub): left alone.
    const newer = { ...old, version: "9.0.0" };
    expect(withBundled(newer)).toBe(newer);
    const other = { ...old, id: "https://raw.githubusercontent.com/someone/else/main/stormcentral.json" };
    expect(withBundled(other)).toBe(other);
  });
});
