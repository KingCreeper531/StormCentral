import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RUNNER_LABEL } from "./runner-bridge";

describe("background runner label", () => {
  it("matches capacitor.config.ts (and so the widget's SharedPreferences file)", () => {
    const cfg = readFileSync(path.resolve(import.meta.dirname, "../../../capacitor.config.ts"), "utf8");
    expect(cfg).toContain(`RUNNER_LABEL = "${RUNNER_LABEL}"`);
  });
});
