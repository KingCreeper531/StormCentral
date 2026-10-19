import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "sc-streams-"));
process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Mod = typeof import("./chaser-streams");
let m: Mod;
const NOW = Date.now();

const rss = (name: string, ids: string[]) =>
  `<?xml version="1.0"?><feed><author><name>${name}</name><uri>x</uri></author>${ids.map((id) => `<entry><yt:videoId>${id}</yt:videoId></entry>`).join("")}</feed>`;

beforeAll(async () => {
  m = await import("./chaser-streams");
  const { getDb } = await import("../db/client");
  const { users, chaserPositions } = await import("../db/schema");
  const db = await getDb();
  await db.insert(users).values({ id: "u1", username: "chaser1", email: "c@x.io", passwordHash: "h", displayName: "Chaser", avatarHue: 1, createdAt: NOW });
  // A Storm Central chaser sharing their position, with their own channel linked.
  await db.insert(chaserPositions).values({ userId: "u1", lat: 35, lon: -97, updatedAt: NOW, expiresAt: NOW + 3_600_000, stream: "https://www.youtube.com/@mychase/live" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.YOUTUBE_API_KEY;
});

describe("parseChannelFeed", () => {
  it("reads the channel's name and newest videos", () => {
    expect(m.parseChannelFeed(rss("Ryan Hall, Y&#39;all", ["aaaaaaaaaaa", "bbbbbbbbbbb"]))).toEqual({ name: "Ryan Hall, Y'all", videoIds: ["aaaaaaaaaaa", "bbbbbbbbbbb"] });
  });
});

describe("chaser streams", () => {
  it("without a YouTube key, lists the channels and doesn't call YouTube", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const { load } = m.__test;
    const r = await load();
    expect(r.liveStatus).toBe(false);
    expect(r.live).toEqual([]);
    expect(r.channels[0]).toEqual({ name: "Ryan Hall, Y'all", url: "https://www.youtube.com/channel/UCJHAT3Uvv-g3I8H3GhHWV7w" });
    expect(f).not.toHaveBeenCalled();
  });

  it("finds who's live among the channels' newest videos, the shared chaser's channel included", async () => {
    process.env.YOUTUBE_API_KEY = "k";
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        if (url.includes("/channels?")) return Response.json({ items: [{ id: url.includes("mychase") ? "UCmychase00000000000000" : "UCvince0000000000000000" }] });
        if (url.includes("feeds/videos.xml")) {
          const id = new URL(url).searchParams.get("channel_id");
          if (id === "UCJHAT3Uvv-g3I8H3GhHWV7w") return new Response(rss("Ryan Hall, Y'all", ["ryanlive001", "ryanold0001"]));
          if (id === "UCmychase00000000000000") return new Response(rss("My Chase", ["mychaselive"]));
          return new Response(rss("Someone", ["oldvideo001"]));
        }
        if (url.includes("/videos?")) {
          const live = (id: string, ch: string, title: string, viewers: string) => ({
            id,
            snippet: { channelId: ch, channelTitle: title, title: "LIVE", liveBroadcastContent: "live", thumbnails: { medium: { url: `https://i.ytimg.com/${id}.jpg` } } },
            liveStreamingDetails: { actualStartTime: "2026-05-20T22:00:00Z", concurrentViewers: viewers },
          });
          return Response.json({
            items: [live("ryanlive001", "UCJHAT3Uvv-g3I8H3GhHWV7w", "Ryan Hall, Y'all", "15000"), live("mychaselive", "UCmychase00000000000000", "My Chase", "40"), { id: "ryanold0001", snippet: { channelId: "x", liveBroadcastContent: "none" } }],
          });
        }
        return new Response("nope", { status: 404 });
      }),
    );
    const r = await m.__test.load();
    expect(r.liveStatus).toBe(true);
    expect(r.live.map((s) => [s.videoId, s.viewers, s.handle])).toEqual([
      ["ryanlive001", 15000, null],
      ["mychaselive", 40, "@mychase"],
    ]);
    expect(r.live[0]!.embed).toBe("https://www.youtube-nocookie.com/embed/ryanlive001?autoplay=1");
    // One videos.list call for every channel's newest videos.
    expect(urls.filter((u) => u.includes("/videos?"))).toHaveLength(1);
    expect(r.channels.find((c) => c.url.includes("UCJHAT3"))?.name).toBe("Ryan Hall, Y'all");
  });
});
