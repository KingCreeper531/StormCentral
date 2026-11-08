import { describe, expect, it } from "vitest";
import { groupByPlaylist, isoSeconds, report, type VideoStats } from "./stats";

const v = (over: Partial<VideoStats>): VideoStats => ({ id: "a", title: "A", published: "2026-10-20T12:00:00Z", duration: 45, views: 0, likes: 0, comments: 0, playlists: [], ...over });

describe("YouTube stats", () => {
  it("reads ISO durations", () => {
    expect(isoSeconds("PT1M5S")).toBe(65);
    expect(isoSeconds("PT45S")).toBe(45);
    expect(isoSeconds("PT1H2M")).toBe(3720);
    expect(isoSeconds(undefined)).toBe(0);
  });

  it("groups by playlist, best median first, with the best video of each", () => {
    const groups = groupByPlaylist([
      v({ id: "r1", views: 10, likes: 1, playlists: ["Recaps"] }),
      v({ id: "r2", views: 30, likes: 2, playlists: ["Recaps"] }),
      v({ id: "o1", views: 200, likes: 10, playlists: ["Outlooks"], avgPercent: 80 }),
      v({ id: "x", views: 5 }),
    ]);
    expect(groups.map((g) => g.name)).toEqual(["Outlooks", "Recaps", "Other"]);
    expect(groups[1]).toMatchObject({ videos: 2, views: 40, medianViews: 20, avgPercent: null });
    expect(groups[1]!.likesPer100).toBeCloseTo(7.5);
    expect(groups[1]!.best?.id).toBe("r2");
    expect(groups[0]!.avgPercent).toBe(80);
  });

  it("writes a Markdown report that notes missing watch time", () => {
    const md = report({ subscribers: 12, views: 345, videos: 2 }, [v({ id: "x1", title: "Tornado | Oklahoma", views: 9 })], "Watch time isn't included.");
    expect(md).toContain("12 subscribers, 345 views over 2 videos.");
    expect(md).toContain("> Watch time isn't included.");
    expect(md).toContain("[Tornado \\| Oklahoma](https://youtu.be/x1)");
  });
});
