import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLayerText } from "./load";

const any = AbortSignal.any;

afterEach(() => {
  AbortSignal.any = any;
  vi.unstubAllGlobals();
});

describe("fetchLayerText", () => {
  it("loads on engines without AbortSignal.any (Safari before 17.4), directly or through the proxy", async () => {
    (AbortSignal as { any?: unknown }).any = undefined;
    const proxy = `/api/gis?url=${encodeURIComponent("http://x.test/layer.kml")}`;
    const fetch = vi.fn(async (url: string) => (url === "https://x.test/direct.kml" || url === proxy ? new Response("<kml/>") : Promise.reject(new TypeError("CORS"))));
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    expect(await fetchLayerText("https://x.test/direct.kml", signal)).toBe("<kml/>");
    expect(await fetchLayerText("http://x.test/layer.kml", signal)).toBe("<kml/>");
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["https://x.test/direct.kml", "https://x.test/layer.kml", proxy]);
  });
});
