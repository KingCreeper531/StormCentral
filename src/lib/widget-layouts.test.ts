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

  // A tap target on a view the layout lacks breaks the whole widget ("Problem loading widget").
  const JAVA = join(LAYOUT_DIR, "..", "..", "java", "io", "github", "kingcreeper531", "stormcentral");
  const arrays: [file: string, array: string, layout: string][] = [
    ["WeatherWidgetProvider.java", "WEATHER_VIEWS", "widget_weather"],
    ["StyledWidgetProvider.java", "COMPACT_VIEWS", "widget_compact"],
    ["StyledWidgetProvider.java", "FORECAST_VIEWS", "widget_forecast"],
    ["StyledWidgetProvider.java", "CELL_VIEWS", "widget_cell"],
    ["StyledWidgetProvider.java", "CLOCK_VIEWS", "widget_clock"],
  ];
  it.each(arrays)("%s %s covers exactly the views in %s.xml", (file, array, layout) => {
    const java = readFileSync(join(JAVA, file), "utf8");
    const body = java.match(new RegExp(`${array}\\s*=\\s*\\{([^}]*)\\}`))?.[1] ?? "";
    const listed = [...body.matchAll(/R\.id\.(\w+)/g)].map((m) => m[1]).sort();
    for (const name of [layout, `${layout}_clear`]) {
      const xml = readFileSync(join(LAYOUT_DIR, `${name}.xml`), "utf8");
      const ids = [...xml.matchAll(/android:id="@\+id\/(\w+)"/g)].map((m) => m[1]).sort();
      expect(listed).toEqual(ids);
    }
  });
});
