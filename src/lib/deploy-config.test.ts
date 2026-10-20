import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../..");

describe("vercel.json", () => {
  const config = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8")) as { ignoreCommand?: string };

  it("keeps the ignored-build command within Vercel's 256 characters", () => {
    // Longer fails schema validation and every production deploy with it.
    expect(config.ignoreCommand?.length ?? 0).toBeLessThanOrEqual(256);
  });

  it("points at a script that exists", () => {
    const script = config.ignoreCommand?.match(/^bash (\S+)$/)?.[1];
    expect(script && existsSync(path.join(ROOT, script))).toBeTruthy();
  });
});
