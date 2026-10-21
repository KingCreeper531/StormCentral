import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/community-repo", () => ({ getMedia: async (id: string) => (id.startsWith("0") ? { mime: "image/png", bytes: Buffer.from([1, 2, 3]) } : null) }));

const { GET } = await import("./route");

const get = (id: string) => GET(new Request(`https://storm.test/api/media/${id}`), { params: Promise.resolve({ id }) });

describe("/api/media/[id]", () => {
  it("is cached for an hour, not for good, so a deleted picture goes away", async () => {
    const res = await get("0b7c1e2a-9a51-4c2e-8f4e-2d1c0a9b8e7f");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600, s-maxage=3600");
    expect((await get("9b7c1e2a-9a51-4c2e-8f4e-2d1c0a9b8e7f")).status).toBe(404);
  });
});
