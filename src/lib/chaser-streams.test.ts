import { describe, expect, it } from "vitest";
import { liveFor, liveIndex, parseChannelList, type LiveChaserStream } from "./chaser-streams";
import { parseStream } from "./chasers";

const stream = (over: Partial<LiveChaserStream> = {}): LiveChaserStream => ({
  videoId: "abcdefghijk",
  channelId: "UCJHAT3Uvv-g3I8H3GhHWV7w",
  channelName: "Ryan Hall, Y'all",
  handle: "@ryanhallyall",
  title: "LIVE: Tornado warnings",
  thumbnail: null,
  viewers: 12000,
  startedAt: null,
  url: "https://www.youtube.com/watch?v=abcdefghijk",
  embed: "https://www.youtube-nocookie.com/embed/abcdefghijk?autoplay=1",
  ...over,
});

describe("parseStream", () => {
  it("reads YouTube videos, channels and handles, and nothing else", () => {
    expect(parseStream("https://youtu.be/abcdefghijk")).toMatchObject({ videoId: "abcdefghijk", embed: "https://www.youtube-nocookie.com/embed/abcdefghijk?autoplay=1" });
    expect(parseStream("youtube.com/watch?v=abcdefghijk&t=5")).toMatchObject({ videoId: "abcdefghijk" });
    expect(parseStream("https://www.youtube.com/live/abcdefghijk?si=x")).toMatchObject({ videoId: "abcdefghijk" });
    expect(parseStream("https://m.youtube.com/channel/UCJHAT3Uvv-g3I8H3GhHWV7w")).toMatchObject({ channelId: "UCJHAT3Uvv-g3I8H3GhHWV7w" });
    expect(parseStream("@StormChaserVince")).toEqual({ url: "https://www.youtube.com/@StormChaserVince/live", embed: null, handle: "@stormchaservince" });
    expect(parseStream("https://www.youtube.com/@StormChaserVince/streams")).toMatchObject({ handle: "@stormchaservince" });
    expect(parseStream("https://evil.example/watch?v=abcdefghijk")).toBeNull();
    expect(parseStream("https://youtube.com.evil.example/@x")).toBeNull();
    expect(parseStream("twitch.tv/somebody")).toBeNull();
    expect(parseStream("")).toBeNull();
  });
});

describe("live streams", () => {
  it("takes extra channels from CHASER_CHANNELS and skips junk", () => {
    expect(parseChannelList(" @FreddyMcKinney, UCV6hWxB0-u_IX7e-h4fEBAw, not a channel ,")).toEqual([
      { name: "@FreddyMcKinney", handle: "@FreddyMcKinney" },
      { name: "UCV6hWxB0-u_IX7e-h4fEBAw", channelId: "UCV6hWxB0-u_IX7e-h4fEBAw" },
    ]);
  });

  it("matches a chaser's linked stream by video, channel or handle", () => {
    const live = liveIndex([stream()]);
    expect(liveFor(parseStream("@RyanHallYall"), live)?.videoId).toBe("abcdefghijk");
    expect(liveFor(parseStream("https://www.youtube.com/channel/UCJHAT3Uvv-g3I8H3GhHWV7w"), live)?.videoId).toBe("abcdefghijk");
    expect(liveFor(parseStream("https://youtu.be/abcdefghijk"), live)?.videoId).toBe("abcdefghijk");
    expect(liveFor(parseStream("@somebodyelse"), live)).toBeNull();
    expect(liveFor(null, live)).toBeNull();
  });
});
