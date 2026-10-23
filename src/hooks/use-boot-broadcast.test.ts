import { describe, expect, it } from "vitest";
import { shouldBootBroadcast } from "./use-boot-broadcast";

describe("booting into Broadcast mode", () => {
  it("goes to Broadcast mode on the first open when the setting is on", () => {
    expect(shouldBootBroadcast(true, "", false)).toBe(true);
    expect(shouldBootBroadcast(true, "?lat=35&lon=-97", false)).toBe(true);
  });

  it("stays in the app when it's off, already done in this tab, or the link picks a mode", () => {
    expect(shouldBootBroadcast(false, "", false)).toBe(false);
    expect(shouldBootBroadcast(true, "", true)).toBe(false);
    expect(shouldBootBroadcast(true, "?mode=severe", false)).toBe(false);
  });
});
