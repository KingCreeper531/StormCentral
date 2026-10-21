import { describe, expect, it } from "vitest";
import { rateLimit } from "./rate-limit";

describe("rate limit", () => {
  it("allows up to the limit in the window, then says when to retry", () => {
    const t = 1_000_000;
    expect(rateLimit("t-basic:a", 2, 60_000, t)).toEqual({ ok: true, remaining: 1 });
    expect(rateLimit("t-basic:a", 2, 60_000, t + 1000)).toEqual({ ok: true, remaining: 0 });
    expect(rateLimit("t-basic:a", 2, 60_000, t + 2000)).toEqual({ ok: false, retryAfterSec: 58 });
    expect(rateLimit("t-basic:a", 2, 60_000, t + 60_001).ok).toBe(true);
  });

  it("doesn't count refused requests", () => {
    const t = 2_000_000;
    rateLimit("t-refused:a", 1, 60_000, t);
    for (let i = 1; i <= 50; i++) expect(rateLimit("t-refused:a", 1, 60_000, t + i * 1000).ok).toBe(false);
    // Free again a window after the one request that counted, not after the last refused one.
    expect(rateLimit("t-refused:a", 1, 60_000, t + 60_000).ok).toBe(true);
  });

  it("keeps each kind of limit apart, so flooding one can't reset another", () => {
    const t = 3_000_000;
    for (let i = 0; i < 8; i++) rateLimit("t-acct:victim", 8, 60_000, t);
    expect(rateLimit("t-acct:victim", 8, 60_000, t).ok).toBe(false);
    // More made-up keys than a store holds, all under another prefix.
    for (let i = 0; i < 25_000; i++) rateLimit(`t-ip:${i}`, 20, 60_000, t);
    expect(rateLimit("t-acct:victim", 8, 60_000, t + 1).ok).toBe(false);
  });
});
