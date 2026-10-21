import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Budget, YouTubeLive } from "./youtube-live";

// 11:59 PM Pacific (YouTube's quota day), a minute before the day turns over.
const LATE = Date.parse("2026-05-21T06:59:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(LATE);
});
afterEach(() => vi.useRealTimers());

describe("Budget", () => {
  it("allows so many a day, and starts over when YouTube's quota day (Pacific) does", () => {
    const b = new Budget(2);
    expect([b.take(), b.take(), b.take()]).toEqual([true, true, false]);
    expect(b.left).toBe(false);
    vi.setSystemTime(LATE + 2 * 60_000);
    expect(b.left).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.state).toEqual({ day: "2026-05-21", used: 1 });
  });

  it("lets the owner save the count each time one is taken", () => {
    const onTake = vi.fn();
    const b = new Budget(1, onTake);
    b.take();
    b.take();
    expect(onTake).toHaveBeenCalledTimes(1);
  });

  it("carries on from a count saved earlier the same quota day, so a restart doesn't start it over", () => {
    const before = new Budget(3);
    before.take();
    before.take();
    const after = new Budget(3);
    after.restore(JSON.parse(JSON.stringify(before.state)));
    expect([after.take(), after.take()]).toEqual([true, false]);
  });

  it("ignores a count from an earlier day, or nothing saved", () => {
    const b = new Budget(1);
    b.restore({ day: "2026-05-19", used: 1 });
    b.restore(undefined);
    expect(b.take()).toBe(true);
    // Saved just before midnight Pacific, restored just after.
    const old = new Budget(1);
    old.take();
    vi.setSystemTime(LATE + 2 * 60_000);
    const next = new Budget(1);
    next.restore(old.state);
    expect(next.take()).toBe(true);
  });
});

describe("YouTubeLive.canRetitle", () => {
  const options = { segments: "", tmp: "", privacy: "public", clipsPerDay: 1, log: () => {} };
  const credentials = { clientId: "id", clientSecret: "secret", refreshToken: "token" };

  it("is false without credentials, and once the day's titles are used up", () => {
    expect(new YouTubeLive({ ...options, credentials: null, titlesPerDay: 20 }).canRetitle(true)).toBe(false);
    const yt = new YouTubeLive({ ...options, credentials, titlesPerDay: 1 });
    expect(yt.canRetitle(false)).toBe(true);
    yt.titles.take();
    expect(yt.canRetitle(true)).toBe(false);
  });

  it("counts titles and clips through onBudget, for the director to save", () => {
    const onBudget = vi.fn();
    const yt = new YouTubeLive({ ...options, credentials, titlesPerDay: 5, onBudget });
    yt.titles.take();
    yt.clips.take();
    expect(onBudget).toHaveBeenCalledTimes(2);
  });
});
