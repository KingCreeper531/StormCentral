import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MPING_OPTIONS, mpingOption } from "../mping";
import { descriptionFor, mpingDescriptions, resetMpingMenu, submitToMping } from "./mping";

/** mPING's description list, two pages, the way its API pages it. */
const PAGES: Record<string, unknown> = {
  "https://mping.test/v2/description": {
    next: "https://mping.test/v2/description?page=2",
    results: [
      { id: 1, name: "None", active: true, category: { id: 1, name: "None" } },
      { id: 11, name: "Pea (0.25 in.)", active: true, category: { id: 5, name: "Hail" } },
      { id: 14, name: "Quarter (1.00 in.)", active: true, category: { id: 5, name: "Hail" } },
      { id: 15, name: "Half Dollar (1.25 in.)", active: true, category: { id: 5, name: "Hail" } },
      { id: 19, name: "Hen Egg (2.00 in.)", active: true, category: { id: 5, name: "Hail" } },
      { id: 20, name: "Hen Egg+ (2.25 in.)", active: true, category: { id: 5, name: "Hail" } },
    ],
  },
  "https://mping.test/v2/description?page=2": {
    next: null,
    results: [
      { id: 30, name: "Lawn furniture or trash cans displaced; Small twigs broken", active: true, category: { name: "Wind Damage" } },
      { id: 41, name: "Tornado (on ground)", active: true, category: { name: "Tornado" } },
      { id: 42, name: "Water Spout", active: true, category: { name: "Tornado" } },
      { id: 50, name: "Old type", active: false, category: { name: "Hail" } },
      { id: 60, name: "Dense Fog", active: true, category: { name: "Reduced Visibility" } },
    ],
  },
};

const fakeFetch = () =>
  vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (init?.method === "POST") return Response.json({ type: "FeatureCollection", features: [{ id: 987, properties: { obtime: "x" } }] }, { status: 201 });
    const page = PAGES[u];
    return page ? Response.json(page) : new Response("nope", { status: 404 });
  });

beforeEach(() => {
  process.env.MPING_TOKEN = "secret";
  process.env.MPING_API_URL = "https://mping.test/v2/";
  resetMpingMenu();
});
afterEach(() => {
  delete process.env.MPING_TOKEN;
  delete process.env.MPING_API_URL;
});

describe("mPING", () => {
  it("reads every page of active report types", async () => {
    const items = await mpingDescriptions(fakeFetch());
    expect(items.map((d) => d.id)).toEqual([1, 11, 14, 15, 19, 20, 30, 41, 42, 60]);
    expect(items.find((d) => d.id === 30)?.category).toBe("Wind Damage");
  });

  it("finds each option's report type by name", async () => {
    const items = await mpingDescriptions(fakeFetch());
    const id = (category: string, key: string) => descriptionFor(mpingOption(category, key)!, items);
    expect(id("hail", "hail-quarter")).toBe(14);
    expect(id("hail", "hail-half-dollar")).toBe(15);
    expect(id("hail", "hail-egg")).toBe(19);
    expect(id("wind", "wind-twigs")).toBe(30);
    expect(id("tornado", "tornado")).toBe(41);
    expect(id("tornado", "waterspout")).toBe(42);
    expect(id("fog", "fog")).toBe(60);
    expect(id("hail", "hail-golf")).toBeNull();
  });

  it("submits the type, time and point with the token, and keeps mPING's id", async () => {
    const f = fakeFetch();
    const id = await submitToMping({ category: "hail", option: "hail-quarter", lat: 35.22, lon: -97.44, at: Date.UTC(2026, 4, 20, 23, 5, 7, 123) }, f);
    expect(id).toBe("987");
    const post = f.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(String(post[0])).toBe("https://mping.test/v2/reports");
    expect(JSON.parse(String(post[1]!.body))).toEqual({ description_id: 14, obtime: "2026-05-20T23:05:07Z", geom: { type: "Point", coordinates: [-97.44, 35.22] } });
    expect((post[1]!.headers as Record<string, string>).Authorization).toBe("Token secret");
  });

  it("sends nothing without a token, or for a category mPING doesn't take", async () => {
    const f = fakeFetch();
    expect(await submitToMping({ category: "sky", option: "x", lat: 1, lon: 1, at: 0 }, f)).toBeNull();
    delete process.env.MPING_TOKEN;
    expect(await submitToMping({ category: "hail", option: "hail-quarter", lat: 1, lon: 1, at: 0 }, f)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("only offers options mPING takes, with unique keys", () => {
    const keys = Object.values(MPING_OPTIONS).flatMap((list) => list!.map((o) => o.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect(MPING_OPTIONS.lightning).toBeUndefined();
    expect(mpingOption("hail", "wind-twigs")).toBeNull();
  });
});
