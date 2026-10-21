import { afterAll, describe, expect, it, vi } from "vitest";

describe("palette store", () => {
  afterAll(() => vi.unstubAllGlobals());

  it("takes up a colour table another window picked", async () => {
    const saved = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => saved.get(k) ?? null,
      setItem: (k: string, v: string) => void saved.set(k, v),
      removeItem: (k: string) => void saved.delete(k),
    });
    const page = new EventTarget();
    vi.stubGlobal("window", page);
    const { usePaletteStore } = await import("./palette-store");
    const { BUILTIN_PALETTES } = await import("@/lib/pro/palettes");
    const other = BUILTIN_PALETTES.find((p) => p.scale === "ref")!;
    expect(usePaletteStore.getState().chosen.ref).toBeUndefined();
    // The other window saves, and this one hears of it.
    const key = usePaletteStore.persist.getOptions().name!;
    saved.set(key, JSON.stringify({ state: { chosen: { ref: other.id }, imported: [] }, version: 1 }));
    page.dispatchEvent(Object.assign(new Event("storage"), { key }));
    await Promise.resolve();
    expect(usePaletteStore.getState().chosen.ref).toBe(other.id);
  });
});
