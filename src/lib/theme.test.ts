import { describe, expect, it } from "vitest";
import { THEME_BOOT_SCRIPT } from "./theme";

/** Runs the pre-paint boot script against a stand-in document and storage; returns <html>'s state. */
function boot(stored: Record<string, unknown>) {
  const props: Record<string, string> = {};
  const root = { dataset: {} as Record<string, string>, style: { colorScheme: "", setProperty: (k: string, v: string) => (props[k] = v) } };
  const storage = { getItem: (k: string) => (k in stored ? JSON.stringify(stored[k]) : null) };
  const media = () => ({ matches: false });
  new Function("localStorage", "window", "matchMedia", "document", THEME_BOOT_SCRIPT)(storage, { matchMedia: media }, media, { documentElement: root });
  return { dataset: root.dataset, props };
}

const withTheme = (theme: Record<string, unknown>) => ({
  "stormcentral:addons:v1": { state: { activeTheme: "t", themes: [{ id: "t", ...theme }] } },
});

describe("THEME_BOOT_SCRIPT", () => {
  it("puts a dot-matrix theme's font on <html> before the page paints", () => {
    const { dataset, props } = boot(withTheme({ base: "dark", font: "dot", colors: { canvas: "#000000", accent: "#ff3b3f" } }));
    expect(dataset).toMatchObject({ theme: "dark", font: "dot" });
    expect(props["--color-accent"]).toBe("#ff3b3f");
  });

  it("leaves the font alone for other themes, and for no theme", () => {
    expect(boot(withTheme({ base: "light", colors: { canvas: "#ffffff" } })).dataset).toEqual({ theme: "light" });
    expect(boot({}).dataset).toEqual({ theme: "dark" });
  });
});
