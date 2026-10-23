import { describe, expect, it, vi } from "vitest";
import { failuresCheck, report, runChecks, tokenCheck, uploadCheck } from "./health";

const NOW = Date.parse("2026-10-23T12:40:00Z");
const s = (d: string) => Date.parse(d) / 1000;

describe("health check", () => {
  it("flags a Facebook token that's invalid or expiring within 10 days, and passes one that never expires", () => {
    expect(tokenCheck({ is_valid: false, error: { message: "Session has expired" } }, NOW)).toMatchObject({ level: "problem", detail: expect.stringContaining("Session has expired") });
    expect(tokenCheck({ is_valid: true, expires_at: s("2026-10-23T19:00:00Z") }, NOW)).toMatchObject({ level: "problem", detail: expect.stringContaining("Expires in 0 days") });
    expect(tokenCheck({ is_valid: true, expires_at: 0, data_access_expires_at: s("2026-10-30T00:00:00Z") }, NOW).level).toBe("problem");
    expect(tokenCheck({ is_valid: true, expires_at: 0, data_access_expires_at: s("2027-01-15T00:00:00Z") }, NOW)).toMatchObject({ level: "ok", detail: "Valid until 2027-01-15." });
    expect(tokenCheck({ is_valid: true, expires_at: 0 }, NOW)).toMatchObject({ level: "ok", detail: "Valid, never expires." });
  });

  it("wants a YouTube upload in the last 30 hours", () => {
    expect(uploadCheck("2026-10-22T13:20:00Z", NOW).level).toBe("ok");
    expect(uploadCheck("2026-10-21T13:20:00Z", NOW)).toMatchObject({ level: "problem", detail: expect.stringContaining("47 hours ago") });
    expect(uploadCheck(null, NOW).level).toBe("problem");
  });

  it("warns on a failed run or two and calls a run of them a problem", () => {
    expect(failuresCheck({ "facebook-warnings.yml": 0 }).level).toBe("ok");
    expect(failuresCheck({ "facebook-warnings.yml": 1 }).level).toBe("warn");
    expect(failuresCheck({ "facebook-warnings.yml": 30, "youtube-shorts.yml": 0 })).toMatchObject({ level: "problem", detail: "facebook-warnings.yml: 30 failed" });
  });

  it("skips what isn't set up, and one broken check doesn't stop the others", async () => {
    const f = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("stormcentralwx.com")) return new Response("ok");
      throw new Error("network down");
    });
    const checks = await runChecks({ ANTHROPIC_API_KEY: "k" }, f as unknown as typeof fetch, NOW);
    expect(checks.find((c) => c.name === "Facebook Page token")?.level).toBe("skip");
    expect(checks.find((c) => c.name === "YouTube")?.level).toBe("skip");
    expect(checks.find((c) => c.name.startsWith("Anthropic"))?.level).toBe("warn");
    expect(checks.filter((c) => c.name.includes("stormcentralwx.com")).map((c) => c.level)).toEqual(["ok", "ok"]);
    expect(report(checks)).toMatch(/^## All good/);
  });
});
