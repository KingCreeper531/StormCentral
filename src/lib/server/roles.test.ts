import { afterEach, describe, expect, it } from "vitest";
import { isDeveloper, isModerator, isTrustedSpotter } from "../auth/session";
import { badgeFor, rankOf } from "../community";

const saved = { DEVELOPERS: process.env.DEVELOPERS, MODERATORS: process.env.MODERATORS, TRUSTED_SPOTTERS: process.env.TRUSTED_SPOTTERS };
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

  it("grants Trusted Spotter to zenitsu132 and anyone in TRUSTED_SPOTTERS", () => {
    delete process.env.TRUSTED_SPOTTERS;
    expect(isTrustedSpotter("Zenitsu132")).toBe(true);
    expect(isTrustedSpotter("someone")).toBe(false);
    process.env.TRUSTED_SPOTTERS = "someone, other";
    expect(isTrustedSpotter("Someone")).toBe(true);
    expect(isTrustedSpotter("zenitsu132")).toBe(true);
  });

  it("ranks a granted Trusted Spotter at least that, and higher once confirmations earn it", () => {
    expect(badgeFor({ reputation: 2, trusted: true }).name).toBe("Trusted Spotter");
    expect(rankOf({ reputation: 2, trusted: true })).toBe(25);
    expect(badgeFor({ reputation: 140, trusted: true }).name).toBe("Storm Chaser");
    expect(badgeFor({ reputation: 2, trusted: false }).name).toBe("Observer");
  });

  it("shows Developer instead of the rank", () => {
    expect(badgeFor({ reputation: 0, developer: true }).name).toBe("Developer");
    expect(badgeFor({ reputation: 0, developer: false }).name).toBe("Observer");
    expect(badgeFor({ reputation: 30 }).name).toBe("Trusted Spotter");
  });
});
