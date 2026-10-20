import { describe, expect, it } from "vitest";
import { offsetFromCentre, pickWhere, strongestEcho } from "./app-capture";

describe("offsetFromCentre", () => {
  const okc = { lat: 35.47, lon: -97.52 };
  it("puts the centre at 0,0, east to the right and north up", () => {
    expect(offsetFromCentre(okc, okc)).toEqual([0, 0]);
    const [x, y] = offsetFromCentre(okc, { lat: 36.47, lon: -96.52 });
    // One degree of longitude at zoom 6.4: 512 × 2^6.4 / 360 ≈ 120 px.
    expect(x).toBeCloseTo((512 * 2 ** 6.4) / 360, 6);
    expect(y).toBeLessThan(-140);
  });
});

describe("strongestEcho", () => {
  const img = (w: number, h: number, paint: (x: number, y: number) => [number, number, number] | null) => {
    const px = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = paint(x, y) ?? [12, 14, 20];
        px.set([...c, 255], (y * w + x) * 4);
      }
    return px;
  };

  it("finds the storm's core, not a stray red pixel or a big area of green", () => {
    const px = img(200, 120, (x, y) => {
      if (x === 10 && y === 10) return [0xfd, 0, 0]; // a stray pixel (a warning outline, say)
      if ((x - 150) ** 2 + (y - 60) ** 2 < 15 ** 2) return (x - 150) ** 2 + (y - 60) ** 2 < 4 ** 2 ? [0xf8, 0, 0xfd] : [0xfd, 0x95, 0];
      if (x < 100) return [0x01, 0xc5, 0x01];
      return null;
    });
    const hit = strongestEcho(px, 200, 120)!;
    expect(hit.dbz).toBe(65);
    expect(Math.hypot(hit.x - 150, hit.y - 60)).toBeLessThan(5);
  });

  it("finds nothing when no echo reaches 40 dBZ, and keeps to the area asked", () => {
    expect(strongestEcho(img(80, 80, () => [0x01, 0xc5, 0x01]), 80, 80)).toBeNull();
    const two = img(200, 100, (x, y) => ((x - 40) ** 2 + (y - 50) ** 2 < 100 || (x - 160) ** 2 + (y - 50) ** 2 < 100 ? [0xfd, 0, 0] : null));
    expect(strongestEcho(two, 200, 100, { x: 160, y: 50, radius: 30 })!.x).toBeGreaterThan(140);
  });
});

describe("pickWhere", () => {
  const alerts = (features: unknown[]) => (async () => new Response(JSON.stringify({ features }), { status: 200 })) as unknown as typeof fetch;
  const poly = (event: string, ring: number[][], sent = "2026-10-28T16:00:00Z") => ({ geometry: { type: "Polygon", coordinates: [ring] }, properties: { event, areaDesc: "Cleveland, OK; McClain, OK", sent } });

  it("centres on the most serious warning in effect", async () => {
    const svr = poly("Severe Thunderstorm Warning", [[-100, 40], [-99, 40], [-99, 41], [-100, 41], [-100, 40]]);
    const tor = poly("Tornado Warning", [[-97.6, 35.2], [-97.2, 35.2], [-97.2, 35.4], [-97.6, 35.4], [-97.6, 35.2]]);
    expect(await pickWhere(alerts([svr, tor]))).toEqual({ lat: 35.3, lon: -97.4, name: "Cleveland, OK", warning: "Tornado Warning" });
  });

  it("falls back to Oklahoma City with no warnings, or when the NWS can't be reached", async () => {
    expect((await pickWhere(alerts([]))).name).toBe("Oklahoma City");
    const down = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await pickWhere(down)).toMatchObject({ name: "Oklahoma City" });
  });
});
