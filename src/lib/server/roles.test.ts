import { afterEach, describe, expect, it } from "vitest";
import { isDeveloper, isModerator } from "../auth/session";
import { badgeFor } from "../community";

const saved = { DEVELOPERS: process.env.DEVELOPERS, MODERATORS: process.env.MODERATORS };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
  else process.env[k] = v;
});

describe("roles", () => {
  it("badges the official account as Developer by default, case-insensitively", () => {
    delete process.env.DEVELOPERS;
    expect(isDeveloper("StormCentral_Official")).toBe(true);
    expect(isDeveloper("stormcentral_official")).toBe(true);
    expect(isDeveloper("someone")).toBe(false);
  });

  it("follows DEVELOPERS and MODERATORS when set", () => {
    process.env.DEVELOPERS = "alice, Bob";
    process.env.MODERATORS = "carl";
    expect(isDeveloper("bob")).toBe(true);
    expect(isDeveloper("StormCentral_Official")).toBe(false);
    expect(isModerator("Carl")).toBe(true);
    expect(isModerator("alice")).toBe(false);
  });

  it("shows Developer instead of the rank", () => {
    expect(badgeFor({ reputation: 0, developer: true }).name).toBe("Developer");
    expect(badgeFor({ reputation: 0, developer: false }).name).toBe("Observer");
    expect(badgeFor({ reputation: 30 }).name).toBe("Trusted Spotter");
  });
});
