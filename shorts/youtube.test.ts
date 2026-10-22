import { afterEach, describe, expect, it, vi } from "vitest";
import { addToPlaylist, liveBroadcast } from "./youtube";

// Shapes from the YouTube Data API's liveStreams.list and liveBroadcasts.list.
const STREAMS = {
  items: [
    { id: "stream-main", cdn: { ingestionInfo: { streamName: "aaaa-bbbb-cccc-dddd" } } },
    { id: "stream-vertical", cdn: { ingestionInfo: { streamName: "vvvv-wwww-xxxx-yyyy" } } },
  ],
};
const BROADCASTS = {
  items: [
    { id: "video-vertical", snippet: { liveChatId: "chat-vertical" }, contentDetails: { boundStreamId: "stream-vertical" } },
    { id: "video-main", snippet: { liveChatId: "chat-main" }, contentDetails: { boundStreamId: "stream-main" } },
  ],
};

/** fetch answering liveStreams and liveBroadcasts, recording the URLs asked for. */
function api(streams: unknown = STREAMS, broadcasts: unknown = BROADCASTS) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(url.includes("/liveStreams?") ? streams : broadcasts), { status: 200 });
  });
  return urls;
}

afterEach(() => vi.unstubAllGlobals());

describe("liveBroadcast", () => {
  it("finds the broadcast fed by this stream's key when two are on air", async () => {
    api();
    expect(await liveBroadcast("token", "aaaa-bbbb-cccc-dddd")).toEqual({ id: "video-main", chatId: "chat-main" });
    expect(await liveBroadcast("token", "vvvv-wwww-xxxx-yyyy")).toEqual({ id: "video-vertical", chatId: "chat-vertical" });
  });

  it("never sends the key: it's only compared with the channel's streams", async () => {
    const urls = api();
    await liveBroadcast("token", "aaaa-bbbb-cccc-dddd");
    expect(urls.some((u) => u.includes("aaaa-bbbb"))).toBe(false);
  });

  it("returns nothing rather than another stream's broadcast", async () => {
    api();
    expect(await liveBroadcast("token", "unknown-key")).toBeNull();
    // This stream's broadcast isn't on air, the other one is.
    api(STREAMS, { items: [BROADCASTS.items[0]] });
    expect(await liveBroadcast("token", "aaaa-bbbb-cccc-dddd")).toBeNull();
  });

  it("takes the only broadcast on air when YouTube doesn't list the key", async () => {
    api({ items: [] }, { items: [BROADCASTS.items[1]] });
    expect(await liveBroadcast("token", "aaaa-bbbb-cccc-dddd")).toEqual({ id: "video-main", chatId: "chat-main" });
  });

  it("takes the one on air without a key, as before", async () => {
    const urls = api();
    expect(await liveBroadcast("token")).toEqual({ id: "video-vertical", chatId: "chat-vertical" });
    expect(urls.some((u) => u.includes("/liveStreams?"))).toBe(false);
    api(STREAMS, { items: [] });
    expect(await liveBroadcast("token")).toBeNull();
  });
});

describe("addToPlaylist", () => {
  /** fetch finding the playlist, then answering the inserts with `statuses` in turn. */
  function playlist(statuses: number[]) {
    const inserts: number[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("/playlists?")) return new Response(JSON.stringify({ items: [{ id: "PL1", snippet: { title: "Daily Severe Weather Outlook" } }] }), { status: 200 });
      const status = statuses[inserts.length] ?? 200;
      inserts.push(status);
      return new Response(JSON.stringify(status === 200 ? { id: "item" } : { error: { message: "The operation was aborted." } }), { status });
    });
    return inserts;
  }

  it("tries again when YouTube aborts the insert", async () => {
    const inserts = playlist([409, 503]);
    await addToPlaylist("vid", "Daily Severe Weather Outlook", "", "token", [0, 0]);
    expect(inserts).toEqual([409, 503, 200]);
  });

  it("gives up after the retries, and at once on other errors", async () => {
    expect(playlist([409, 409, 409])).toBeDefined();
    await expect(addToPlaylist("vid", "Daily Severe Weather Outlook", "", "token", [0, 0])).rejects.toThrow("(409)");
    const inserts = playlist([403]);
    await expect(addToPlaylist("vid", "Daily Severe Weather Outlook", "", "token", [0, 0])).rejects.toThrow("(403)");
    expect(inserts).toEqual([403]);
  });
});
