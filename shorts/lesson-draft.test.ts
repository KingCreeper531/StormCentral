import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LESSONS } from "./kinds/lesson";
import { gates, nextTopic, SAFETY, type Checked } from "./lesson-draft";
import type { Source } from "./research";

const noaa: Source = { title: "JetStream", url: "https://www.weather.gov/jetstream/x", kind: "noaa", text: "" };
const wiki: Source = { title: "Wikipedia: X", url: "https://en.wikipedia.org/wiki/X", kind: "wikipedia", text: "" };
const line = (say: string, source = noaa, ok = true): Checked => ({
  beat: { say, caption: "", claim: true, quotes: [], visual: {} },
  evidence: { verdict: ok ? "supported" : "unsupported", why: "", quotes: [{ text: "q", source }] },
  review: ok ? "supported" : "unsupported",
  ...(ok ? {} : { dropped: "no source" }),
});
const passed = (g: ReturnType<typeof gates>) => g.every((x) => x.ok);
const full = LESSONS[0]!; // a full-length lesson with 6 chapters

describe("auto-approval gates", () => {
  const good = Array.from({ length: 16 }, (_, i) => line(`Fact number ${i} about radar.`));

  it("passes a full draft whose every kept line is backed and reviewed", () => {
    expect(passed(gates(good, full))).toBe(true);
  });

  it("fails when too many lines were dropped", () => {
    const g = gates([...good, ...Array.from({ length: 8 }, () => line("Made up.", noaa, false))], full);
    expect(g.find((x) => x.name === "Few lines dropped")!.ok).toBe(false);
  });

  it("fails when too few lines survive", () => {
    expect(passed(gates(good.slice(0, 10), full))).toBe(false);
  });

  it("fails when safety advice comes only from Wikipedia", () => {
    const g = gates([...good, line("Take shelter in an interior room when a warning is issued.", wiki)], full);
    expect(g.find((x) => x.name === "Safety advice only from NOAA/NWS")!.ok).toBe(false);
    expect(passed(gates([...good, line("Take shelter in an interior room when a warning is issued.", noaa)], full))).toBe(true);
  });

  it("fails when a kept line wasn't agreed by the second model", () => {
    const g = gates([...good.slice(1), { ...good[0]!, review: "partly" }], full);
    expect(g.find((x) => x.name === "Every kept line backed and reviewed")!.ok).toBe(false);
  });

  it("knows safety talk when it sees it", () => {
    expect(SAFETY.test("Never try to outrun a tornado in a car.")).toBe(true);
    expect(SAFETY.test("Green means toward the radar.")).toBe(false);
  });
});

describe("nextTopic", () => {
  it("takes the first topic in the queue that has no lesson yet", () => {
    const dir = mkdtempSync(join(tmpdir(), "topics-"));
    writeFileSync(join(dir, "topics.txt"), "# comment\nvelocity | radar velocity\nhooks | hook echoes | https://www.weather.gov/a, https://www.weather.gov/b\n");
    writeFileSync(join(dir, "velocity.json"), "{}");
    expect(nextTopic(join(dir, "topics.txt"), dir)).toEqual({ id: "hooks", topic: "hook echoes", urls: ["https://www.weather.gov/a", "https://www.weather.gov/b"] });
  });

  it("reads the real queue", () => {
    const t = nextTopic();
    expect(t === null || (/^[a-z0-9-]+$/.test(t.id) && t.topic.length > 3)).toBe(true);
  });
});
