/**
 * Draws the Short: template.html in headless Chromium (playwright-core), frame by
 * frame, piped into ffmpeg as a 1080x1920 H.264 MP4 with no sound.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright-core";
import type { GeoCollection } from "./meta";

export interface ShortData {
  states: unknown;
  cat: GeoCollection;
  torn: GeoCollection;
  wind: GeoCollection;
  hail: GeoCollection;
  outlook: { risk: string | null; code: string | null; level: number; region: string; summary: string; date: string };
}

const FPS = 30;

export async function renderShort(data: ShortData, out: string, { dir = "shorts", logo = "desktop/resources/icon.png" } = {}): Promise<void> {
  mkdirSync(dirname(out), { recursive: true });
  const pageData = { ...data, logo: `data:image/png;base64,${readFileSync(logo).toString("base64")}` };
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(`window.DATA = ${JSON.stringify(pageData)};`);
    await page.goto(`file://${resolve(dir, "template.html")}`);
    await page.evaluate(async () => {
      await document.fonts.load('700 40px "SC Inter"');
      await document.fonts.ready;
    });
    if (errors.length) throw new Error(`template.html: ${errors.join("; ")}`);
    const duration = await page.evaluate(() => (window as unknown as { DUR: number }).DUR);

    const ff = spawn(
      "ffmpeg",
      ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out],
      { stdio: ["pipe", "inherit", "inherit"] },
    );
    const done = new Promise<number>((res, rej) => {
      ff.on("error", rej);
      ff.on("close", (code) => res(code ?? 1));
    });
    for (let i = 0; i < duration * FPS; i++) {
      const url = await page.evaluate((t) => {
        (window as unknown as { render: (t: number) => void }).render(t);
        return (document.getElementById("c") as HTMLCanvasElement).toDataURL("image/jpeg", 0.93);
      }, i / FPS);
      if (!ff.stdin.write(Buffer.from(url.slice(url.indexOf(",") + 1), "base64"))) await new Promise((r) => ff.stdin.once("drain", r));
    }
    ff.stdin.end();
    const code = await done;
    if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
    if (errors.length) throw new Error(`template.html: ${errors.join("; ")}`);
  } finally {
    await browser.close();
  }
}
