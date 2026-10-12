import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error: plain ESM build script without type declarations
import { clearTwin, LAYOUT_DIR, WIDGET_LAYOUTS } from "../../scripts/widget-clear-layouts.mjs";

describe("transparent widget layouts", () => {
  it.each(WIDGET_LAYOUTS as string[])("%s_clear.xml matches %s.xml (run scripts/widget-clear-layouts.mjs)", (name) => {
    const base = readFileSync(join(LAYOUT_DIR, `${name}.xml`), "utf8");
    expect(readFileSync(join(LAYOUT_DIR, `${name}_clear.xml`), "utf8")).toBe(clearTwin(name, base));
  });

  it("adds a shadow to every text view and keeps every id", () => {
    const base = readFileSync(join(LAYOUT_DIR, "widget_clock.xml"), "utf8");
    const twin = clearTwin("widget_clock", base);
    const ids = (xml: string) => [...xml.matchAll(/android:id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids(twin)).toEqual(ids(base));
    const texts = base.match(/<(TextView|TextClock)\b/g)!.length;
    expect(twin.match(/android:shadowColor=/g)!.length).toBe(texts);
  });
});
