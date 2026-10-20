import { afterEach, describe, expect, it, vi } from "vitest";
import { chunkVolume, L2_CHUNKS_BUCKET, liveVolumes, newestCandidates, nextVolume, parseChunkKey, prevVolume } from "./aws";

describe("real-time Level II chunks", () => {
  it("reads chunk keys", () => {
    expect(parseChunkKey("KTLX/893/20261020-181800-001-S")).toEqual({ volume: 893, time: Date.UTC(2026, 9, 20, 18, 18, 0), seq: 1, kind: "S" });
    expect(parseChunkKey("KTLX/7/20261020-181800-055-E")?.kind).toBe("E");
    expect(parseChunkKey("KTLX/893/")).toBeNull();
    expect(parseChunkKey("2026/10/20/KTLX/KTLX20261020_181800_V06")).toBeNull();
  });

  it("takes the unbroken run of a volume's chunks, from its start", () => {
    const k = (seq: number, kind = "I", time = "20261020-181800", vol = 893) => `KTLX/${vol}/${time}-${String(seq).padStart(3, "0")}-${kind}`;
    const v = chunkVolume([k(2), k(1, "S"), k(3)]);
    expect(v).toEqual({ volume: 893, time: Date.UTC(2026, 9, 20, 18, 18), urls: [1, 2, 3].map((n) => `${L2_CHUNKS_BUCKET}/${k(n, n === 1 ? "S" : "I")}`), done: false });
    // A late chunk leaves a hole: only what comes before it.
    expect(chunkVolume([k(1, "S"), k(2), k(4)])?.urls).toHaveLength(2);
    expect(chunkVolume([k(1, "S"), k(2), k(3, "E")])?.done).toBe(true);
    // Nothing to decode without the start chunk.
    expect(chunkVolume([k(2), k(3)])).toBeNull();
    expect(chunkVolume([])).toBeNull();
    // The number reused by a newer scan: only the newer one.
    expect(chunkVolume([k(1, "S", "20261017-120000"), k(2, "I", "20261017-120000"), k(1, "S")])?.urls).toEqual([`${L2_CHUNKS_BUCKET}/${k(1, "S")}`]);
  });

  it("counts volumes 1 to 999 and around again", () => {
    expect(nextVolume(998)).toBe(999);
    expect(nextVolume(999)).toBe(1);
    expect(prevVolume(1)).toBe(999);
    expect(prevVolume(500)).toBe(499);
  });

  it("narrows the newest volume to the ends of the biggest gaps", () => {
    // Today's run 527–893, strays from earlier days at 269, 418 and 496.
    const v = [269, ...Array.from({ length: 81 }, (_, i) => 322 + i), 418, 496, ...Array.from({ length: 367 }, (_, i) => 527 + i)];
    expect(newestCandidates(v)).toContain(893);
    expect(newestCandidates(v, 1)).toEqual([893]);
    // Wrapped: the newest is just past 999.
    expect(newestCandidates([995, 996, 997, 998, 999, 1, 2, 3], 1)).toEqual([3]);
  });
});

describe("liveVolumes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("finds the volume being scanned, then follows it with small listings", async () => {
    const keys = (vol: number, time: string, n: number, done: boolean) =>
      Array.from({ length: n }, (_, i) => `KTEST/${vol}/${time}-${String(i + 1).padStart(3, "0")}-${i === 0 ? "S" : done && i === n - 1 ? "E" : "I"}`);
    const bucket: Record<number, string[]> = {
      100: keys(100, "20261017-120000", 1, false), // a stray from days ago
      998: keys(998, "20261020-180000", 55, true),
      999: keys(999, "20261020-180500", 55, true),
      1: keys(1, "20261020-181000", 12, false),
    };
    const xml = (ks: string[]) => `<ListBucketResult>${ks.map((k) => `<Contents><Key>${k}</Key></Contents>`).join("")}</ListBucketResult>`;
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const u = new URL(url);
      const prefix = u.searchParams.get("prefix")!;
      requests.push(prefix + (u.searchParams.get("delimiter") ? " (volumes)" : ""));
      if (u.searchParams.get("delimiter")) return new Response(`<ListBucketResult>${Object.keys(bucket).map((v) => `<CommonPrefixes><Prefix>KTEST/${v}/</Prefix></CommonPrefixes>`).join("")}</ListBucketResult>`);
      return new Response(xml(bucket[Number(prefix.split("/")[1])] ?? []));
    });

    const first = await liveVolumes("KTEST", 3);
    expect(first.map((v) => [v.volume, v.urls.length, v.done])).toEqual([
      [998, 55, true],
      [999, 55, true],
      [1, 12, false],
    ]);

    // The scan goes on and the next volume starts.
    bucket[1] = keys(1, "20261020-181000", 55, true);
    bucket[2] = keys(2, "20261020-181500", 3, false);
    requests.length = 0;
    const next = await liveVolumes("KTEST", 3);
    expect(next.map((v) => [v.volume, v.urls.length, v.done])).toEqual([
      [999, 55, true],
      [1, 55, true],
      [2, 3, false],
    ]);
    // No volume listing again, and finished volumes aren't listed again.
    expect(requests).toEqual(["KTEST/2/", "KTEST/3/", "KTEST/1/"]);
  });
});
