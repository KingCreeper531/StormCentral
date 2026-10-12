import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveManifest } from "./github";
import { FEATURED_PLUGINS, FEATURED_THEMES } from "./featured";
import { AddonError, expandTileUrl, parseAddon, themeVars } from "./manifest";

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

  it("accepts WMTS {z}/{y}/{x} order and fills date tokens", () => {
    const p = parseAddon({ type: "plugin", name: "P", layers: [{ type: "raster", tiles: ["https://g.example/{date}/{z}/{y}/{x}.jpg"], visible: false }] }, src);
    expect(p.type === "plugin" && p.layers[0]?.visible).toBe(false);
    const now = Date.parse("2026-10-12T05:00:00Z");
    expect(expandTileUrl("https://g.example/{date}/{date-2}/{z}", now)).toBe("https://g.example/2026-10-11/2026-10-10/{z}");
  });
});
