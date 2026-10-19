import { describe, expect, it } from "vitest";
import { cachedJsonResponse } from "./respond";

const req = (etag?: string) => new Request("https://x/api/hazards", { headers: etag ? { "If-None-Match": etag } : {} });

describe("cachedJsonResponse", () => {
  it("sends the JSON with CDN caching and an ETag", async () => {
    const res = cachedJsonResponse(req(), { a: 1 }, 120);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60, s-maxage=120, stale-while-revalidate=240");
    expect(res.headers.get("ETag")).toMatch(/^"[\w-]+"$/);
    expect(await res.json()).toEqual({ a: 1 });
  });

  it("answers an unchanged poll with an empty 304, weak or strong", async () => {
    const etag = cachedJsonResponse(req(), { a: 1 }, 60).headers.get("ETag")!;
    for (const sent of [etag, `W/${etag}`, `"other", ${etag}`]) {
      const res = cachedJsonResponse(req(sent), { a: 1 }, 60);
      expect(res.status).toBe(304);
      expect(await res.text()).toBe("");
      expect(res.headers.get("ETag")).toBe(etag);
    }
    expect(cachedJsonResponse(req(etag), { a: 2 }, 60).status).toBe(200);
  });
});
