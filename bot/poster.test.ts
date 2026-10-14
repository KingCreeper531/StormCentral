import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { posterFromEnv, twikitPoster, type TwikitOptions } from "./poster";
import { XError } from "./x-client";

// A stand-in for twikit_post.py, run with Node instead of Python: it answers
// with FAKE_ANSWER, and records its arguments and stdin in FAKE_LOG.
const dir = mkdtempSync(join(tmpdir(), "poster-test-"));
const script = join(dir, "fake.mjs");
writeFileSync(
  script,
  `import { appendFileSync, existsSync } from "node:fs";
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const post = JSON.parse(input || "{}");
  appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args: process.argv.slice(2), post, imageExists: post.image ? existsSync(post.image) : null }) + "\\n");
  console.log("some twikit chatter");
  console.log(process.env.FAKE_ANSWER);
});`,
);
const cookies = join(dir, "cookies.json");
writeFileSync(cookies, "{}");
const opts: TwikitOptions = { python: process.execPath, script, cookies, account: "Storm__Central" };

const log = join(dir, "log.jsonl");
const runs = async () => {
  const { readFileSync } = await import("node:fs");
  return readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
};
const answer = (a: unknown) => (process.env.FAKE_ANSWER = typeof a === "string" ? a : JSON.stringify(a));

afterEach(() => {
  writeFileSync(log, "");
  delete process.env.FAKE_ANSWER;
});
process.env.FAKE_LOG = log;

describe("twikitPoster", () => {
  it("posts and returns the id, passing the cookies and the one allowed account", async () => {
    answer({ ok: true, id: "42", image: false });
    await expect(twikitPoster(opts).post("hello")).resolves.toBe("42");
    const [run] = await runs();
    expect(run.args).toEqual(["--cookies", cookies, "--account", "Storm__Central"]);
    expect(run.post).toEqual({ text: "hello", image: null });
  });

  it("hands over the image as a temporary file and deletes it afterwards", async () => {
    answer({ ok: true, id: "43", image: true });
    await twikitPoster(opts).post("map", { bytes: new Uint8Array([137, 80, 78, 71]), type: "image/png" });
    const [run] = await runs();
    expect(run.post.image).toMatch(/\.png$/);
    expect(run.imageExists).toBe(true);
    expect(existsSync(run.post.image)).toBe(false);
  });

  it.each([
    ["duplicate", 403],
    ["rate", 429],
    ["locked", 401],
    ["suspended", 401],
    ["unauthorized", 401],
    ["automated", 401],
    ["rejected", 400],
    ["error", 500],
  ] as const)("reports %s as status %i", async (kind, status) => {
    answer({ ok: false, kind, message: "nope" });
    const err = await twikitPoster(opts).post("x").catch((e) => e);
    expect(err).toBeInstanceOf(XError);
    expect(err.status).toBe(status);
    expect(err.message).toContain(kind);
  });

  it("treats no answer as an error", async () => {
    answer("not json");
    const err = await twikitPoster(opts).post("x").catch((e) => e);
    expect(err).toBeInstanceOf(XError);
    expect(err.status).toBe(500);
  });

  it("says so when Python can't start", async () => {
    const err = await twikitPoster({ ...opts, python: join(dir, "no-such-python") })
      .post("x")
      .catch((e) => e);
    expect(err).toBeInstanceOf(XError);
    expect(err.message).toMatch(/Couldn't start Python/);
  });
});

describe("posterFromEnv", () => {
  it("is a dry run without credentials", () => {
    expect(posterFromEnv({})).toBeNull();
  });

  it("uses the X API with its four secrets", () => {
    expect(posterFromEnv({ X_API_KEY: "a", X_API_SECRET: "b", X_ACCESS_TOKEN: "c", X_ACCESS_SECRET: "d" })?.kind).toBe("api");
  });

  it("uses twikit when asked, and only with a cookies file", () => {
    expect(posterFromEnv({ BOT_POSTER: "twikit", BOT_TWIKIT_COOKIES: cookies })?.kind).toBe("twikit");
    expect(posterFromEnv({ BOT_POSTER: "twikit", BOT_TWIKIT_COOKIES: join(dir, "missing.json") })).toBeNull();
  });
});
