import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { glmKeyTime, GlmWindow, readFlashes } from "./glm";

const KEY = "OR_GLM-L2-LCFA_G18_s20262941157000_e20262941157200_c20262941157218.nc";
const bytes = () => {
  const b = readFileSync(join(__dirname, "__fixtures__", KEY));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const START = Date.UTC(2026, 9, 21, 11, 57, 0);
const WORLD = [-180, -90, 180, 90] as const;

/** A fake NOAA bucket: GOES-West holds the fixture in the 11 UTC folder, everything else is empty. */
function bucket(file: () => ArrayBuffer | Response = bytes) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("?list-type=2")) {
      const keys = url.includes("noaa-goes18") && url.includes(encodeURIComponent("GLM-L2-LCFA/2026/294/11/")) ? [`GLM-L2-LCFA/2026/294/11/${KEY}`] : [];
      return new Response(`<ListBucketResult>${keys.map((k) => `<Contents><Key>${k}</Key></Contents>`).join("")}</ListBucketResult>`);
    }
    const body = file();
    return body instanceof Response ? body : new Response(body);
  });
}

describe("GOES GLM flashes", () => {
  it("dates files by their scan start, day of year included", () => {
    expect(glmKeyTime(KEY)).toBe(START);
    expect(glmKeyTime("OR_GLM-L2-LCFA_G19_s20260010000000_e20260010000200_c1.nc")).toBe(Date.UTC(2026, 0, 1));
    expect(glmKeyTime("OR_GLM-L2-LCFA_G19_s20243661200350_e1.nc")).toBe(Date.UTC(2024, 11, 31, 12, 0, 35));
    expect(glmKeyTime("KTLX20261019_155210_V06")).toBeNaN();
  });

  it("reads a real LCFA file's good flashes, as netCDF4 does", () => {
    const { lon, lat } = readFlashes(bytes());
    expect(lon.length).toBe(27);
    expect([lon[0], lat[0]]).toEqual([Math.fround(-109.23360443115234), Math.fround(35.85129165649414)]);
    expect([lon[26], lat[26]]).toEqual([Math.fround(-113.86772918701172), Math.fround(37.74059295654297)]);
    expect(() => readFlashes(new ArrayBuffer(64))).toThrow(/not a GLM file/);
  });

  it("keeps GOES-West's flashes west of 106°W and answers for an area, oldest first", async () => {
    const get = bucket();
    const glm = new GlmWindow(get);
    const now = START + 60_000;
    const all = await glm.flashes(WORLD, now);
    // 15 of the file's 27 are west of the split (GOES-East covers the rest).
    expect(all.flashes).toHaveLength(15);
    expect(all.flashes.every(([lon]) => lon < -106)).toBe(true);
    // Dated at the middle of the file's 20 s: 50 s before `now`.
    expect(all.flashes.every(([, , ago]) => ago === 50)).toBe(true);
    expect(all).toMatchObject({ generated: new Date(now).toISOString(), minutes: 15 });
    expect(glm.query([-110, 30, -106, 40], now).flashes.length).toBeLessThan(15);
    expect(glm.query([0, 0, 10, 10], now).flashes).toEqual([]);
  });

  it("fetches each file once and lists again only after 20 s", async () => {
    const get = bucket();
    const glm = new GlmWindow(get);
    const now = START + 60_000;
    await glm.flashes(WORLD, now);
    const files = () => get.mock.calls.filter(([u]) => !String(u).includes("?list-type=2")).length;
    expect(files()).toBe(1);
    const calls = get.mock.calls.length;
    await glm.flashes(WORLD, now + 10_000);
    expect(get.mock.calls.length).toBe(calls);
    await glm.flashes(WORLD, now + 30_000);
    expect(get.mock.calls.length).toBeGreaterThan(calls);
    expect(files()).toBe(1);
  });

  it("lets flashes go after 15 minutes", async () => {
    const glm = new GlmWindow(bucket());
    await glm.refresh(START + 60_000);
    expect(glm.query(WORLD, START + 10 + 15 * 60_000).flashes).toHaveLength(15);
    expect(glm.query(WORLD, START + 11_000 + 15 * 60_000).flashes).toEqual([]);
  });

  it("tries a file that couldn't be read again next time", async () => {
    let broken = true;
    const glm = new GlmWindow(bucket(() => (broken ? new Response("busy", { status: 503 }) : bytes())));
    const now = START + 60_000;
    expect((await glm.flashes(WORLD, now)).flashes).toEqual([]);
    broken = false;
    expect((await glm.flashes(WORLD, now + 20_000)).flashes).toHaveLength(15);
  });

  it("fails when NOAA's bucket can't be reached at all, so the map can fall back", async () => {
    const glm = new GlmWindow(vi.fn(async () => new Response("down", { status: 503 })));
    await expect(glm.flashes(WORLD, START)).rejects.toMatchObject({ status: 503 });
  });
});
