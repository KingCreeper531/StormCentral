import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { RawAlertFeature } from "../src/lib/alerts";
import { deletePost, pageFromEnv, pageInfo, postPhoto, postToPage, resolvePage, secretProblems } from "./facebook";
import { postedLastHour, warningPosts, withinCap, type PostState } from "./warning-posts";

// The saved Moore scenario: a PDS tornado warning upgraded to a Tornado Emergency, and a plain tornado warning in Creek County.
const FEATURES = (JSON.parse(readFileSync("shorts/fixtures/breaking/tornado-emergency/nws-active.json", "utf8")) as { features: RawAlertFeature[] }).features;
const NOW = Date.parse("2026-05-21T01:00:00Z"); // 8:00 PM CDT
const EMERGENCY = "KOUN.TO.W.45.2026";
const CREEK = "KTSA.TO.W.31.2026";

describe("warning posts", () => {
  it("posts each warning once, from its newest message, most dangerous first", () => {
    const posts = warningPosts(FEATURES, {}, { now: NOW });
    expect(posts.map((p) => [p.base, p.level, p.title, p.upgrade])).toEqual([
      [EMERGENCY, 4, "TORNADO EMERGENCY", false],
      [CREEK, 2, "TORNADO WARNING", false],
    ]);
  });

  it("writes the NWS's facts, what to do, the link and the reminder", () => {
    const m = warningPosts(FEATURES, {}, { now: NOW })[0]!.message;
    expect(m).toMatch(/^TORNADO EMERGENCY for Cleveland, McClain and Oklahoma counties in Oklahoma until 8:30 PM CDT\./);
    expect(m).toContain("Tornado: observed");
    expect(m).toContain("basement or an interior room");
    expect(m).toContain("Issued by the National Weather Service in Norman, OK.");
    expect(m).toContain("https://app.stormcentralwx.com");
    expect(m).toContain("not an official warning source");
    expect(m).toMatch(/#TornadoWarning #okwx$/);
  });

  it("posts a warning again only when it's upgraded", () => {
    const after = warningPosts(FEATURES, { [EMERGENCY]: 3 }, { now: NOW });
    expect(after.map((p) => [p.base, p.upgrade])).toEqual([
      [EMERGENCY, true],
      [CREEK, false],
    ]);
    expect(after[0]!.message).toMatch(/^UPGRADED: TORNADO EMERGENCY/);
    expect(warningPosts(FEATURES, { [EMERGENCY]: 4, [CREEK]: 2 }, { now: NOW })).toEqual([]);
  });

  it("skips warnings about to end, and ordinary severe thunderstorm warnings unless asked", () => {
    expect(warningPosts(FEATURES, {}, { now: Date.parse("2026-05-21T01:07:00Z") }).map((p) => p.base)).toEqual([EMERGENCY]);
    const svr = structuredClone(FEATURES[2]!);
    Object.assign(svr.properties, { event: "Severe Thunderstorm Warning", parameters: { VTEC: ["/O.NEW.KTSA.SV.W.0100.260521T0045Z-260521T0115Z/"], thunderstormDamageThreat: ["CONSIDERABLE"] } });
    expect(warningPosts([svr], {}, { now: NOW })).toEqual([]);
    expect(warningPosts([svr], {}, { now: NOW, severe: "all" })[0]!.title).toBe("SEVERE THUNDERSTORM WARNING");
    svr.properties.parameters = { VTEC: ["/O.NEW.KTSA.SV.W.0100.260521T0045Z-260521T0115Z/"], thunderstormDamageThreat: ["DESTRUCTIVE"] };
    expect(warningPosts([svr], {}, { now: NOW })[0]!.title).toBe("DESTRUCTIVE SEVERE THUNDERSTORM WARNING");
  });

  it("keeps to the hourly cap, the most dangerous first", () => {
    const posts = warningPosts(FEATURES, {}, { now: NOW });
    const state: PostState = { levels: {}, at: { a: NOW - 10 * 60_000, b: NOW - 50 * 60_000, old: NOW - 2 * 3_600_000 } };
    expect(postedLastHour(state, NOW)).toBe(2);
    const { post, skip } = withinCap(posts, state, 3, NOW);
    expect(post.map((p) => p.base)).toEqual([EMERGENCY]);
    expect(skip.map((p) => p.base)).toEqual([CREEK]);
  });
});

describe("Facebook Graph API", () => {
  const page = { id: "123", token: "page-token" };

  it("posts to the Page's feed, hidden when asked, and deletes", async () => {
    const calls: { url: string; method?: string; body?: string }[] = [];
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method, body: init?.body ? String(init.body) : undefined });
      return Response.json(init?.method === "POST" ? { id: "123_456" } : init?.method === "DELETE" ? { success: true } : { id: "123", name: "Storm Central" });
    });
    expect((await pageInfo(page, f as typeof fetch)).name).toBe("Storm Central");
    expect(await postToPage(page, "Hello", { published: false }, f as typeof fetch)).toBe("123_456");
    await deletePost(page, "123_456", f as typeof fetch);
    expect(calls[0]!.url).toMatch(/^https:\/\/graph\.facebook\.com\/v\d+\.0\/123\?fields=id%2Cname%2Clink&access_token=page-token$/);
    expect(calls[1]).toMatchObject({ url: expect.stringMatching(/\/123\/feed$/), method: "POST" });
    expect(new URLSearchParams(calls[1]!.body)).toEqual(new URLSearchParams({ message: "Hello", published: "false", access_token: "page-token" }));
    expect(calls[2]).toMatchObject({ url: expect.stringContaining("/123_456?"), method: "DELETE" });
  });

  it("reports Meta's error without the token", async () => {
    const f = vi.fn(async () => Response.json({ error: { message: "Invalid OAuth access token.", code: 190 } }, { status: 400 }));
    const err = await postToPage(page, "Hello", {}, f as unknown as typeof fetch).catch((e: Error) => e);
    expect(String(err)).toContain("Invalid OAuth access token.");
    expect(String(err)).not.toContain("page-token");
  });
});

describe("Facebook secrets' shape", () => {
  const token = `EAA${"x".repeat(180)}`;
  it("finds nothing wrong with a Page token and a numeric id", () => {
    expect(secretProblems("1234567890", token)).toEqual([]);
  });
  it("names quotes, swapped secrets, an App Secret, a cut-off token and a bad id, without the token", () => {
    expect(secretProblems("1234567890", `"${token}"`)[0]).toMatch(/quotes/);
    expect(secretProblems(token, "1234567890")[0]).toMatch(/swapped/);
    expect(secretProblems("1234567890", "0123456789abcdef0123456789abcdef")[0]).toMatch(/doesn't start with "EAA" \(32 characters\)/);
    expect(secretProblems("1234567890", "EAAabc")[0]).toMatch(/cut off/);
    expect(secretProblems("storm-central", token)[0]).toMatch(/isn't only digits/);
    for (const bad of [`"${token}"`, "EAAabc"]) for (const p of secretProblems("1", bad)) expect(p).not.toContain(bad.replace(/"/g, ""));
  });
});

describe("the token's Page", () => {
  const reply = (body: unknown) => vi.fn(async () => Response.json(body)) as unknown as typeof fetch;

  it("needs only the token, and posts to the token's own Page", async () => {
    expect(pageFromEnv({ FB_PAGE_TOKEN: " t " })).toEqual({ id: "", token: "t" });
    expect(pageFromEnv({ FB_PAGE_ID: "1" })).toBeNull();
    const r = await resolvePage({ id: "", token: "t" }, reply({ id: "555", name: "Storm Central", metadata: { type: "page" } }));
    expect(r).toMatchObject({ page: { id: "555", token: "t" }, name: "Storm Central", mismatch: false });
  });

  it("notices an FB_PAGE_ID that isn't the Page (the App ID), and a token that isn't the Page's", async () => {
    expect((await resolvePage({ id: "999", token: "t" }, reply({ id: "555", name: "Storm Central", metadata: { type: "page" } }))).mismatch).toBe(true);
    const err = await resolvePage({ id: "", token: "t" }, reply({ id: "7", name: "Someone", metadata: { type: "user" } })).catch((e: Error) => e);
    expect(String(err)).toMatch(/FB_PAGE_TOKEN is a user token .*me\/accounts/);
  });
});

describe("the post's picture", () => {
  it("carries the warning's facts, colour and polygon for the card", () => {
    const [emergency, creek] = warningPosts(FEATURES, {}, { now: NOW });
    expect(emergency!.card).toMatchObject({ title: "TORNADO EMERGENCY", color: "#ff2bd6", where: "Cleveland, McClain and Oklahoma counties in Oklahoma", until: "8:30 PM CDT", issuer: "National Weather Service in Norman, OK" });
    expect(emergency!.card.chips).toContainEqual({ label: "Tornado", value: "observed" });
    expect(emergency!.card.geometry?.type).toBe("Polygon");
    expect(creek!.card.color).toBe("#ff1f1f");
    expect(warningPosts(FEATURES, { [EMERGENCY]: 3 }, { now: NOW })[0]!.card.title).toBe("UPGRADED: TORNADO EMERGENCY");
  });

  it("uploads the picture with the text as a photo post", async () => {
    let sent: FormData | null = null;
    let url = "";
    const f = vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
      url = String(u);
      sent = init?.body as FormData;
      return Response.json({ id: "999", post_id: "123_999" });
    });
    const id = await postPhoto({ id: "123", token: "page-token" }, Buffer.from([0xff, 0xd8, 0xff]), "TORNADO WARNING for Creek county", {}, f as unknown as typeof fetch);
    expect(id).toBe("123_999");
    expect(url).toMatch(/\/123\/photos$/);
    expect(sent!.get("message")).toBe("TORNADO WARNING for Creek county");
    expect((sent!.get("source") as Blob).type).toBe("image/jpeg");
    expect(sent!.get("published")).toBeNull();
  });
});
