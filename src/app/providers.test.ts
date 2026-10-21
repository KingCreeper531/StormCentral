import { afterEach, describe, expect, it, vi } from "vitest";
import { useAddonsStore } from "@/store/addons-store";
import { useAlertsStore } from "@/store/alerts-store";
import { useAppStore } from "@/store/app-store";
import { useChaserStore } from "@/store/chaser-store";
import { browserStorage, restoreStores } from "./providers";

afterEach(() => vi.unstubAllGlobals());

// Tests run without localStorage, like a browser that blocks site data.
describe("blocked site storage", () => {
  it("reads as no storage instead of throwing", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
    expect(browserStorage()).toBeUndefined();
  });

  it("still restores every store, from its defaults", () => {
    expect(useAppStore.persist).toBeUndefined(); // what zustand does without storage
    expect(() => restoreStores()).not.toThrow();
    for (const store of [useAppStore, useAlertsStore, useAddonsStore, useChaserStore]) expect(store.getState().hydrated).toBe(true);
  });

  it("rehydrates stores that have storage", () => {
    const rehydrate = vi.fn();
    const setState = vi.fn();
    restoreStores([{ persist: { rehydrate }, setState }]);
    expect(rehydrate).toHaveBeenCalledOnce();
    expect(setState).not.toHaveBeenCalled();
  });
});
