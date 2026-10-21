import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { disableSync, enableSync, syncOnFor, useSyncStatus } from "./client";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  const saved = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v), removeItem: (k: string) => void saved.delete(k) });
  const events = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("document", { ...events, visibilityState: "visible" });
  vi.stubGlobal("window", events);
});

afterEach(async () => {
  disableSync();
  // Let a round started by the test settle before its fetch goes away.
  await new Promise((r) => setTimeout(r, 0));
  vi.unstubAllGlobals();
});

describe("enableSync", () => {
  it("leaves sync off and rejects with the reason when the first sync fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: null, changedAt: 9 }, 409)));
    await expect(enableSync("u1", "device")).rejects.toThrow("Another device changed the settings just now");
    expect(syncOnFor("u1")).toBe(false);
    expect(useSyncStatus.getState().state).toBe("off");

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(enableSync("u1", "account")).rejects.toThrow("Failed to fetch");
    expect(syncOnFor("u1")).toBe(false);
  });

  it("turns sync on when it works", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => (init?.method === "PUT" ? json({ changedAt: 5 }) : json({ data: null, changedAt: 0 }))));
    await enableSync("u1", "device");
    expect(syncOnFor("u1")).toBe(true);
    expect(useSyncStatus.getState().state).not.toBe("error");
  });
});
