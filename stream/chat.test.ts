import * as grpc from "@grpc/grpc-js";
import { afterAll, describe, expect, it } from "vitest";
import type { Place } from "./analysis";
import { alertsText, ChatReader, chatService, Cooldowns, findPlace, forecastText, parseCommand, type ChatMessage } from "./chat";

const PLACES: Place[] = [
  { name: "Moore", state: "OK", lat: 35.339, lon: -97.487, pop: 62000 },
  { name: "Oklahoma City", state: "OK", lat: 35.468, lon: -97.516, pop: 681000 },
  { name: "Springfield", state: "MO", lat: 37.215, lon: -93.298, pop: 169000 },
  { name: "Springfield", state: "IL", lat: 39.802, lon: -89.644, pop: 114000 },
  { name: "St. Louis", state: "MO", lat: 38.627, lon: -90.199, pop: 301000 },
];

describe("parseCommand", () => {
  it("reads commands and their aliases", () => {
    expect(parseCommand("!forecast Moore, OK")).toEqual({ cmd: "forecast", arg: "Moore, OK" });
    expect(parseCommand("  !WX   tulsa  ")).toEqual({ cmd: "forecast", arg: "tulsa" });
    expect(parseCommand("!warnings Norman")).toEqual({ cmd: "alerts", arg: "Norman" });
    expect(parseCommand("!help")).toEqual({ cmd: "help", arg: "" });
  });
  it("ignores everything else", () => {
    expect(parseCommand("what's the forecast?")).toBeNull();
    expect(parseCommand("!dance")).toBeNull();
    expect(parseCommand("hi !forecast moore")).toBeNull();
  });
});

describe("findPlace", () => {
  it("finds a town with or without its state, the bigger one when it's ambiguous", () => {
    expect(findPlace("Moore, OK", PLACES)?.name).toBe("Moore");
    expect(findPlace("oklahoma city", PLACES)?.name).toBe("Oklahoma City");
    expect(findPlace("Springfield", PLACES)?.state).toBe("MO");
    expect(findPlace("Springfield, Illinois", PLACES)?.state).toBe("IL");
    expect(findPlace("saint louis mo", PLACES)?.name).toBe("St. Louis");
  });
  it("finds nothing for anything that isn't a known town", () => {
    expect(findPlace("Moore, TX", PLACES)).toBeNull();
    expect(findPlace("some words here", PLACES)).toBeNull();
    expect(findPlace("", PLACES)).toBeNull();
  });
});

describe("answers", () => {
  it("states the forecast in one chat message", () => {
    const text = forecastText("Moore, OK", {
      current: { temperature_2m: 71.6, weather_code: 2 },
      daily: { weather_code: [95, 0], temperature_2m_max: [78.2, 81], temperature_2m_min: [60, 62], precipitation_probability_max: [70, 5], wind_gusts_10m_max: [38, 12] },
    });
    expect(text).toMatch(/^Moore, OK: now 72°F, partly cloudy\. Today: 78°F\/60°F, thunderstorm.*70% rain, gusts 38 mph\. Tomorrow: 81°F\/62°F, clear\.$/i);
    expect(text.length).toBeLessThanOrEqual(200);
  });
  it("lists the alerts in effect, each once, with local end times", () => {
    expect(alertsText("Moore, OK", "OK", [])).toBe("Moore, OK: no watches, warnings or advisories in effect right now.");
    const t = alertsText("Moore, OK", "OK", [
      { event: "Tornado Warning", ends: "2026-05-21T01:15:00Z" },
      { event: "Tornado Watch", ends: "2026-05-21T06:00:00Z" },
      { event: "Tornado Watch", ends: "2026-05-21T06:00:00Z" },
    ]);
    expect(t).toBe("Moore, OK: Tornado Warning until 8:15 PM CDT · Tornado Watch until 1:00 AM CDT");
    const many = alertsText("Moore, OK", "OK", Array.from({ length: 12 }, (_, i) => ({ event: `Some Long Advisory Number ${i}`, ends: null })));
    expect(many.length).toBeLessThanOrEqual(200);
    expect(many).toMatch(/and \d+ more$/);
  });
});

describe("Cooldowns", () => {
  it("lets each viewer ask once a minute, moderators any time, and spaces everyone out", () => {
    const c = new Cooldowns(60_000, 6_000);
    expect(c.take("a", false, 0)).toBe(true);
    expect(c.take("b", false, 1_000)).toBe(false);
    expect(c.take("b", false, 7_000)).toBe(true);
    expect(c.take("a", false, 20_000)).toBe(false);
    expect(c.take("a", true, 30_000)).toBe(true);
    expect(c.take("a", false, 100_000)).toBe(true);
  });
});

describe("ChatReader", () => {
  const server = new grpc.Server();
  afterAll(() => server.forceShutdown());

  it("streams new text messages from YouTube's streamList service, once each", async () => {
    const now = Date.now();
    const msg = (id: string, at: number, text: string, type = "TEXT_MESSAGE_EVENT", mod = false) => ({
      id,
      snippet: { type, publishedAt: new Date(at).toISOString(), textMessageDetails: { messageText: text } },
      authorDetails: { channelId: `UC${id}`, isChatModerator: mod },
    });
    let request: Record<string, unknown> = {};
    let auth: unknown;
    server.addService(chatService().service, {
      StreamList(call: grpc.ServerWritableStream<Record<string, unknown>, unknown>) {
        request = call.request;
        auth = call.metadata.get("authorization")[0];
        call.write({ nextPageToken: "p1", items: [msg("old", now - 60_000, "!forecast before we started")] });
        call.write({ nextPageToken: "p2", items: [msg("m1", now, "!forecast Moore, OK"), msg("m1", now, "!forecast Moore, OK"), msg("x", now, "", "NEW_SPONSOR_EVENT"), msg("m2", now, "!radar Tulsa", "TEXT_MESSAGE_EVENT", true)] });
      },
    });
    const port = await new Promise<number>((res, rej) => server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (e, p) => (e ? rej(e) : res(p))));

    const got: ChatMessage[] = [];
    const reader = new ChatReader({
      token: async () => "tok",
      chatId: async () => "chat-1",
      onMessage: (m) => got.push(m),
      log: () => {},
      address: `127.0.0.1:${port}`,
      credentials: grpc.credentials.createInsecure(),
    });
    void reader.run();
    for (let i = 0; i < 50 && got.length < 2; i++) await new Promise((r) => setTimeout(r, 50));
    reader.close();

    expect(request).toMatchObject({ liveChatId: "chat-1", part: ["id", "snippet", "authorDetails"] });
    expect(auth).toBe("Bearer tok");
    expect(got.map((m) => [m.id, m.text, m.moderator])).toEqual([
      ["m1", "!forecast Moore, OK", false],
      ["m2", "!radar Tulsa", true],
    ]);
  });
});
