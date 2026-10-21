import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { decodedValueAt, holdDecodes, jobKey, peekDecoded, requestDecode, type DecodeJob } from "./client";
import { parseLevel3 } from "./level3";
import type { DecodeRequest } from "./protocol";
import { azimuthIndex, levelAt } from "./sweep";

const sweep = parseLevel3(new Uint8Array(readFileSync(join(__dirname, "__fixtures__", "TLX_N0C_2026_10_19_15_52_10"))));

/** Decodes held back until the test lets them finish. */
const slow = new Map<string, () => void>();

/** The decode worker, answering at once (or when let go, for URLs starting "slow"). */
class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: unknown = null;
  postMessage(req: DecodeRequest) {
    const answer = () => this.onmessage?.({ data: { id: req.id, ok: true, sweep, colors: new Uint8Array(4), cuts: [], complete: true } } as MessageEvent);
    if (req.kind === "l3" && req.url.startsWith("slow")) slow.set(req.url, answer);
    else queueMicrotask(answer);
  }
  terminate() {}
}

const job = (url: string): DecodeJob => ({ kind: "l3", url, scale: "ref" });
const state = (url: string) => peekDecoded(jobKey(job(url)))?.state;
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("decoded frame cache", () => {
  beforeAll(() => vi.stubGlobal("Worker", FakeWorker));
  afterAll(() => vi.unstubAllGlobals());

  it("keeps the frames a pane shows while other panes decode theirs", async () => {
    const shown = Array.from({ length: 10 }, (_, i) => job(`shown${i}`));
    const release = holdDecodes(shown);
    await settle();
    for (let i = 0; i < 120; i++) {
      requestDecode(job(`other${i}`));
      await settle();
    }
    expect(shown.map((j) => peekDecoded(jobKey(j))?.state)).toEqual(Array(10).fill("done"));
    // The others are still bounded: the oldest are gone.
    expect(state("other0")).toBeUndefined();
    expect(state("other119")).toBe("done");
    // Let go, they're ordinary old frames again.
    release();
    requestDecode(job("other120"));
    expect(state("shown0")).toBeUndefined();
  });

  it("keeps the frames a pane's next list shares with its last, however full the cache", async () => {
    const releaseOthers = holdDecodes(Array.from({ length: 85 }, (_, i) => job(`busy${i}`)));
    const list = (from: number) => Array.from({ length: 10 }, (_, i) => job(`loop${from + i}`));
    const release = holdDecodes(list(0));
    await settle();
    // A new scan: the list moves on by one (React lets go of the old list, then holds the new one).
    release();
    const releaseNext = holdDecodes(list(1));
    expect(list(1).slice(0, 9).map((j) => peekDecoded(jobKey(j))?.state)).toEqual(Array(9).fill("done"));
    expect(state("loop0")).toBeUndefined();
    releaseNext();
    releaseOthers();
  });

  it("never drops a decode still in flight", async () => {
    requestDecode(job("slow-1"));
    for (let i = 0; i < 120; i++) {
      requestDecode(job(`more${i}`));
      await settle();
    }
    expect(state("slow-1")).toBe("pending");
    slow.get("slow-1")!();
    await settle();
    expect(state("slow-1")).toBe("done");
  });

  it("reads exact values from the frame's own sweep", () => {
    const lon = sweep.lon + 50 / (111.195 * Math.cos((sweep.lat * Math.PI) / 180));
    const lvl = levelAt(sweep, sweep.lat, lon, azimuthIndex(sweep));
    const r = decodedValueAt(sweep, sweep.lat, lon);
    const sp = sweep.special.find((s) => s.level === lvl);
    expect(r).toEqual(sp ? { value: null, special: sp.label } : { value: Number.isNaN(sweep.table[lvl]!) ? null : sweep.table[lvl], special: null });
    expect(decodedValueAt(sweep, sweep.lat + 10, sweep.lon)).toBeNull();
  });
});
