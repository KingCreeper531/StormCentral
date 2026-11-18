import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const manifest = readFileSync(path.resolve(import.meta.dirname, "../../android/app/src/main/AndroidManifest.xml"), "utf8");

describe("Android manifest", () => {
  it("keeps the app's data (the signed-in session among it) out of device backups", () => {
    const application = /<application\b[^>]*>/.exec(manifest)?.[0] ?? "";
    expect(application).toMatch(/android:allowBackup="false"/);
  });
});
