/**
 * The picture for a warning's Facebook post: warning-card.html drawn in
 * headless Chromium with the polygon over IEM's radar mosaic, as a JPEG.
 * Playwright is loaded only here, when there's a post to make, so the runs
 * that find nothing to post don't need Chromium installed.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { radarBackdrop } from "./kinds/breaking";
import type { GeoCollection } from "./meta";
import { readVendor } from "./source";
import type { WarningCard } from "./warning-posts";

export const CARD = { width: 1080, height: 1350 };
/** The card's map (warning-card.html MAP). */
const MAP = { width: 1080, height: 700 };

/** DATA for warning-card.html: the card and its radar backdrop (null when the radar can't be had). */
export async function cardData(card: WarningCard, logo = "desktop/resources/icon.png") {
  const shapes = { type: "FeatureCollection", features: card.geometry ? [{ type: "Feature", geometry: card.geometry, properties: {} }] : [] } as unknown as GeoCollection;
  const radar = await radarBackdrop({ env: process.env }, shapes, { ...MAP, frac: 0.42 });
  return { states: readVendor("states-10m.json"), card, radar, logo: `data:image/png;base64,${readFileSync(logo).toString("base64")}` };
}

/** The card as a JPEG. */
export async function renderCard(card: WarningCard, { dir = "shorts" } = {}): Promise<Buffer> {
  const data = await cardData(card);
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: CARD });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(`window.DATA = ${JSON.stringify(data)};`);
    await page.goto(`file://${resolve(dir, "warning-card.html")}`);
    const url = await page.evaluate(async () => {
      await document.fonts.load('800 40px "SC Inter"');
      await document.fonts.ready;
      await (window as unknown as { READY?: Promise<unknown> }).READY;
      (window as unknown as { render: () => void }).render();
      return (document.getElementById("c") as HTMLCanvasElement).toDataURL("image/jpeg", 0.92);
    });
    if (errors.length) throw new Error(`warning-card.html: ${errors.join("; ")}`);
    return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  } finally {
    await browser.close();
  }
}
