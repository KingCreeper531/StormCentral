/**
 * Writes the transparent twin of each home-screen widget layout
 * (android/app/src/main/res/layout/<name>_clear.xml): the same views with a
 * text shadow, so white text reads over any wallpaper (see WidgetLook.java).
 * RemoteViews can't set a shadow at runtime, hence the copies.
 *
 *   node scripts/widget-clear-layouts.mjs          write the twins
 *   node scripts/widget-clear-layouts.mjs --check  fail if any is out of date
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const LAYOUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "android", "app", "src", "main", "res", "layout");
export const WIDGET_LAYOUTS = ["widget_weather", "widget_compact", "widget_forecast", "widget_cell", "widget_clock"];

const SHADOW = [
  'android:shadowColor="#99000000"',
  'android:shadowDx="0"',
  'android:shadowDy="1"',
  'android:shadowRadius="4"',
];

/** The transparent twin of a layout's XML. */
export function clearTwin(name, xml) {
  const body = xml.replace(/^<\?xml[^>]*>\s*/, "");
  const shadowed = body.replace(/<(TextView|TextClock)\b([\s\S]*?)(\/?>)/g, (_, tag, attrs, end) => {
    const indent = attrs.match(/\n(\s+)android:/)?.[1] ?? "    ";
    return `<${tag}${attrs.replace(/\s+$/, "")}${SHADOW.map((a) => `\n${indent}${a}`).join("")}${end === "/>" ? " />" : ">"}`;
  });
  return `<?xml version="1.0" encoding="utf-8"?>\n<!-- Generated from ${name}.xml by scripts/widget-clear-layouts.mjs: edit that file and re-run. -->\n${shadowed}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const name of WIDGET_LAYOUTS) {
    const want = clearTwin(name, readFileSync(join(LAYOUT_DIR, `${name}.xml`), "utf8"));
    const path = join(LAYOUT_DIR, `${name}_clear.xml`);
    let have = null;
    try {
      have = readFileSync(path, "utf8");
    } catch {}
    if (have === want) continue;
    if (check) {
      console.error(`${name}_clear.xml is out of date`);
      stale++;
    } else {
      writeFileSync(path, want);
      console.log(`wrote ${name}_clear.xml`);
    }
  }
  if (stale) process.exit(1);
}
