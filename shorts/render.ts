/**
 * Draws a video: its page (outlook.html, recap.html, lesson.html…) in headless
 * Chromium (playwright-core), frame by frame, piped into ffmpeg as an H.264
 * MP4 with no sound: 1080x1920 for the Shorts, or the page canvas's own size
 * (1920x1080 for the Radar School lessons).
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright-core";
const FPS = 30;

interface PageOptions {
  dir?: string;
  logo?: string;
  /** The canvas size: 1080x1920 (a Short) unless the page is landscape. */
  width?: number;
  height?: number;
}

/** Opens `template` with `data` as window.DATA, fonts loaded; `use` draws with it. */
async function withPage<T>(template: string, data: Record<string, unknown>, opts: PageOptions, use: (page: import("playwright-core").Page, errors: string[]) => Promise<T>): Promise<T> {
  const { dir = "shorts", logo = "desktop/resources/icon.png", width = 1080, height = 1920 } = opts;
  const pageData = { ...data, logo: `data:image/png;base64,${readFileSync(logo).toString("base64")}` };
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(`window.DATA = ${JSON.stringify(pageData)};`);
    await page.goto(`file://${resolve(dir, template)}`);
    await page.evaluate(async () => {
      await document.fonts.load('700 40px "SC Inter"');
      await document.fonts.ready;
    });
    if (errors.length) throw new Error(`${template}: ${errors.join("; ")}`);
    return await use(page, errors);
  } finally {
    await browser.close();
  }
}

/** One frame of `template` at `t` seconds as a JPEG (a long video's thumbnail). */
export async function renderStill(template: string, data: Record<string, unknown>, t: number, out: string, opts: PageOptions = {}): Promise<void> {
  mkdirSync(dirname(out), { recursive: true });
  const jpeg = await withPage(template, data, opts, (page) =>
    page.evaluate((at) => {
      (window as unknown as { render: (t: number, still?: boolean) => void }).render(at, true);
      return (document.getElementById("c") as HTMLCanvasElement).toDataURL("image/jpeg", 0.9);
    }, t),
  );
  writeFileSync(out, Buffer.from(jpeg.slice(jpeg.indexOf(",") + 1), "base64"));
}

/** Renders `template` (a page in `dir`) with `data` as window.DATA into the MP4 `out`. */
export async function renderShort(template: string, data: Record<string, unknown>, out: string, opts: PageOptions = {}): Promise<void> {
  mkdirSync(dirname(out), { recursive: true });
  await withPage(template, data, opts, async (page, errors) => {
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
    if (errors.length) throw new Error(`${template}: ${errors.join("; ")}`);
  });
}
