import { describe, expect, it } from "vitest";
import { compareVersions } from "./app-update";

describe("compareVersions", () => {
  it("orders dotted versions numerically", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("v1.2.3", "1.2.4")).toBe(-1);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
  });

  it("ignores prerelease suffixes", () => {
    expect(compareVersions("1.3.0-beta.1", "1.2.9")).toBe(1);
    expect(compareVersions("1.3.0-beta.1", "1.3.0")).toBe(0);
  });
});
