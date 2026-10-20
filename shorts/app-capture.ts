/**
 * Screens of Storm Central's Professional mode for the Radar School lesson on
 * it: headless Chromium opens the live site (or SHORTS_APP_URL), centred on
 * the most serious warning in effect right now (Oklahoma City when there's
 * none), and puts Pro mode through its tools: the panel layouts, the cursor
 * readout over the strongest storm, a sounding, a cross-section through the
 * storm, a two-click storm vector, time of arrival, the warning inspector and
 * WarnGen. Each screen comes with the boxes of the controls the lesson points
 * at (CSS pixels of a 1600x900 window), so lesson.html can zoom onto them.
 *
 * WarnGen issues to the spotter network, so it's shown with a stand-in
 * sign-in (the session and warning list are answered here, and anything it
 * would send is blocked): what a Trusted Spotter sees, with nothing issued.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium, type Locator } from "playwright-core";

export type Box = [number, number, number, number];
export interface Shot {
  /** JPEG data URL, 1.5x the 1600x900 window. */
  img: string;
  w: number;
  h: number;
  boxes: Record<string, Box>;
  points: Record<string, [number, number]>;
}
export interface Screens {
  at: string;
  where: { lat: number; lon: number; name: string; warning?: string };
  shots: Record<string, Shot>;
  /** The product picker's choices, by group (a native menu doesn't show in a screenshot). */
  products: { group: string; items: string[] }[];
}

const VIEW = { width: 1600, height: 900 };
const SCALE = 1.5;
/** The camera Pro mode opens with (professional-workspace.tsx): centred on home. */
const ZOOM = 6.4;
const UA = "StormCentral Radar School (github.com/KingCreeper531/StormCentral)";
const FALLBACK = { lat: 35.47, lon: -97.52, name: "Oklahoma City" };
/** Most serious first: the lesson centres on the first kind with a warning in effect. */
const WARNINGS = ["Tornado Warning", "Severe Thunderstorm Warning", "Flash Flood Warning", "Special Weather Statement"];

type Fetch = typeof fetch;

/** Where to point the camera: the middle of the most serious warning in effect, or Oklahoma City. */
export async function pickWhere(fetchImpl: Fetch = fetch): Promise<Screens["where"]> {
  try {
    const res = await fetchImpl(`https://api.weather.gov/alerts/active?status=actual&event=${encodeURIComponent(WARNINGS.join(","))}`, {
      headers: { "User-Agent": UA, Accept: "application/geo+json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`NWS alerts ${res.status}`);
    const fc = (await res.json()) as {
      features?: { geometry?: { type: string; coordinates: number[][][] } | null; properties: { event: string; areaDesc?: string; sent?: string; headline?: string; description?: string } }[];
    };
    const withShape = (fc.features ?? []).filter(
      // Special Weather Statements also cover dust, fire weather and fog: only the ones about a storm.
      (f) => f.geometry?.type === "Polygon" && f.geometry.coordinates[0]?.length && (f.properties.event !== "Special Weather Statement" || /thunderstorm/i.test(`${f.properties.headline} ${f.properties.description}`)),
    );
    for (const kind of WARNINGS) {
      const pick = withShape.filter((f) => f.properties.event === kind).sort((a, b) => (b.properties.sent ?? "").localeCompare(a.properties.sent ?? ""))[0];
      if (!pick) continue;
      const ring = pick.geometry!.coordinates[0]!.slice(0, -1);
      const lon = ring.reduce((s, p) => s + p[0]!, 0) / ring.length;
      const lat = ring.reduce((s, p) => s + p[1]!, 0) / ring.length;
      const name = (pick.properties.areaDesc ?? kind).split(";")[0]!.trim();
      return { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4, name, warning: kind };
    }
  } catch (err) {
    console.warn(`::warning::Couldn't read the NWS warnings; centring on ${FALLBACK.name}: ${err instanceof Error ? err.message : err}`);
  }
  return FALLBACK;
}

/** Pixel offset of lat/lon from the camera's centre at Pro mode's zoom (MapLibre's 512-px Web Mercator). */
export function offsetFromCentre(centre: { lat: number; lon: number }, p: { lat: number; lon: number }, zoom = ZOOM): [number, number] {
  const size = 512 * 2 ** zoom;
  const x = (lon: number) => ((lon + 180) / 360) * size;
  const y = (lat: number) => {
    const s = Math.sin((lat * Math.PI) / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size;
  };
  return [x(p.lon) - x(centre.lon), y(p.lat) - y(centre.lat)];
}

/** NWS reflectivity colours (src/lib/radar/products.ts) from 40 dBZ up, to find the strongest storm in a screenshot. */
const STRONG: [number, number, number, number][] = [
  [40, 0xe5, 0xbc, 0x00],
  [45, 0xfd, 0x95, 0x00],
  [50, 0xfd, 0x00, 0x00],
  [55, 0xd4, 0x00, 0x00],
  [60, 0xbc, 0x00, 0x00],
  [65, 0xf8, 0x00, 0xfd],
  [70, 0x98, 0x54, 0xc6],
];

/**
 * The strongest storm in an RGBA image: the 12-px cell with the most echo
 * at 40 dBZ and up (stronger counts more), and its strongest pixel. Null when
 * there's nothing that strong. `near` keeps to within `radius` pixels of a point.
 */
export function strongestEcho(px: Uint8ClampedArray | Uint8Array, w: number, h: number, near?: { x: number; y: number; radius: number }): { x: number; y: number; dbz: number } | null {
  const CELL = 12;
  const cw = Math.ceil(w / CELL), ch = Math.ceil(h / CELL);
  const score = new Float64Array(cw * ch);
  const best = new Map<number, { x: number; y: number; dbz: number }>();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (near && (x - near.x) ** 2 + (y - near.y) ** 2 > near.radius ** 2) continue;
      const i = (y * w + x) * 4;
      const r = px[i]!, g = px[i + 1]!, b = px[i + 2]!;
      let dbz = 0, dist = 70 ** 2;
      for (const [v, R, G, B] of STRONG) {
        const d = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2;
        if (d < dist) {
          dist = d;
          dbz = v;
        }
      }
      if (!dbz) continue;
      const c = Math.floor(y / CELL) * cw + Math.floor(x / CELL);
      score[c]! += (dbz - 35) / 5;
      const cur = best.get(c);
      if (!cur || dbz > cur.dbz) best.set(c, { x, y, dbz });
    }
  // A storm, not a stray pixel: the cell and its neighbours together.
  let top = -1, topScore = 6;
  for (let cy = 0; cy < ch; cy++)
    for (let cx = 0; cx < cw; cx++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (cx + dx >= 0 && cx + dx < cw && cy + dy >= 0 && cy + dy < ch) s += score[(cy + dy) * cw + cx + dx]!;
      if (s > topScore) {
        topScore = s;
        top = cy * cw + cx;
      }
    }
  return top < 0 ? null : best.get(top) ?? null;
}

const round = (b: { x: number; y: number; width: number; height: number }): Box => [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)];
const union = (...bs: (Box | undefined)[]): Box | undefined => {
  const ok = bs.filter((b): b is Box => !!b);
  if (!ok.length) return undefined;
  const x0 = Math.min(...ok.map((b) => b[0])), y0 = Math.min(...ok.map((b) => b[1]));
  const x1 = Math.max(...ok.map((b) => b[0] + b[2])), y1 = Math.max(...ok.map((b) => b[1] + b[3]));
  return [x0, y0, x1 - x0, y1 - y0];
};
async function boxOf(l: Locator): Promise<Box | undefined> {
  try {
    const b = await l.first().boundingBox({ timeout: 2_000 });
    return b && b.width > 0 && b.height > 0 ? round(b) : undefined;
  } catch {
    return undefined;
  }
}
const visible = async (l: Locator, timeout: number) =>
  l
    .first()
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
const gone = async (l: Locator, timeout: number) =>
  l
    .first()
    .waitFor({ state: "hidden", timeout })
    .then(() => true)
    .catch(() => false);

/**
 * Pro mode's screens, from `appUrl` (the live site by default). Throws when
 * Pro mode itself doesn't come up; a tool that doesn't (no storm to track,
 * no warning to inspect) is just left out, and the lesson shows another screen.
 */
export async function captureProScreens(appUrl: string, { log = console.log, fetchImpl = fetch as Fetch } = {}): Promise<Screens> {
  const where = await pickWhere(fetchImpl);
  log(`Pro mode screens from ${appUrl}, centred on ${where.name}${where.warning ? ` (${where.warning})` : ""}.`);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE, locale: "en-US", timezoneId: "America/Chicago", colorScheme: "dark", userAgent: undefined });
    await context.addInitScript(() => {
      localStorage.setItem("stormcentral:v1", JSON.stringify({ state: { professional: true, mode: "professional", theme: "dark", units: "imperial" }, version: 1 }));
      localStorage.setItem("stormcentral:pro", JSON.stringify({ state: { layout: "2x2", frames: 10, speed: 1 }, version: 1 }));
    });
    // WarnGen as a Trusted Spotter sees it, without signing anyone in or issuing anything.
    await context.route(/\/api\/auth\/me(\?|$)/, (r) =>
      r.fulfill({ json: { user: { id: "radar-school", username: "radar_school", displayName: "Radar School", avatarHue: 210, avatarUrl: null, moderator: false, suspendedUntil: null } } }),
    );
    await context.route(/\/api\/spotter-warnings/, (r) => (r.request().method() === "GET" ? r.fulfill({ json: { warnings: [], canIssue: true, reason: null, moderator: false } }) : r.abort()));
    await context.route(/\/api\/(reports|community|notifications|chasers)/, (r) => (r.request().method() === "GET" ? r.continue() : r.abort()));

    const page = await context.newPage();
    const scratch = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${appUrl.replace(/\/$/, "")}/?mode=professional&lat=${where.lat}&lon=${where.lon}&name=${encodeURIComponent(where.name)}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.bringToFront();

    const tools = page.getByRole("radiogroup", { name: "Tool" });
    if (!(await visible(tools, 60_000))) {
      const seen = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 600);
      throw new Error(`Professional mode didn't open at ${page.url()} ("${await page.title().catch(() => "")}"). On the page: ${seen || "nothing"}${errors.length ? `. Errors: ${errors.join("; ")}` : ""}`);
    }
    const clock = page.getByText(/\d\d:\d\dZ\s+\d+\/\d+/);
    if (!(await visible(clock, 90_000))) log("::warning::The radar loop didn't load in 90 s; capturing anyway.");
    // Let every panel draw its frames.
    await page.waitForTimeout(12_000);
    // Hold the loop on its newest frame, so every screen shows the same moment.
    const pause = page.getByRole("button", { name: "Pause" });
    if (await visible(pause, 2_000)) await pause.click();
    for (let i = 0; i < 25; i++) {
      const m = (await clock.first().textContent().catch(() => ""))?.match(/(\d+)\/(\d+)/);
      if (!m || m[1] === m[2]) break;
      await page.getByRole("button", { name: "Next frame" }).click();
      await page.waitForTimeout(150);
    }
    const readoutBar = page.locator("div.min-h-9.border-t").last();
    // Move the pointer off the panels, so the shot has no stray crosshair.
    await page.mouse.move(800, 20);
    await page.waitForTimeout(2_500);

    const canvases = page.locator("canvas.maplibregl-canvas");
    const pane = (i: number) => boxOf(canvases.nth(i));
    const aside = page.locator("aside").first();
    const shots: Record<string, Shot> = {};

    const shoot = async (id: string, boxes: Record<string, Box | undefined>, points: Record<string, [number, number]> = {}) => {
      await page.waitForTimeout(400);
      const jpg = await page.screenshot({ type: "jpeg", quality: 84, animations: "disabled", caret: "hide" });
      shots[id] = {
        img: `data:image/jpeg;base64,${jpg.toString("base64")}`,
        w: VIEW.width,
        h: VIEW.height,
        boxes: Object.fromEntries(Object.entries(boxes).filter((e): e is [string, Box] => !!e[1])),
        points,
      };
      log(`  ${id}: ${Object.keys(shots[id]!.boxes).join(", ")}${Object.keys(points).length ? ` · points ${Object.keys(points).join(", ")}` : ""}`);
    };
    const tool = async (name: string) => {
      await tools.getByRole("radio", { name }).click();
      await page.waitForTimeout(800);
    };

    /** The strongest storm on panel 1 (reflectivity) right now, in page pixels. */
    const findStorm = async (near?: { x: number; y: number; radius: number }) => {
      const p1 = await pane(0);
      if (!p1) return null;
      // Leave out the panel's header, zoom buttons and status line.
      const clip = { x: p1[0] + 4, y: p1[1] + 36, width: p1[2] - 70, height: p1[3] - 80 };
      await page.mouse.move(800, 20);
      await page.waitForTimeout(300);
      const png = await page.screenshot({ type: "png", clip, scale: "css" });
      const { data, width, height } = await scratch.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext("2d")!;
        g.drawImage(bmp, 0, 0);
        return { data: Array.from(g.getImageData(0, 0, bmp.width, bmp.height).data), width: bmp.width, height: bmp.height };
      }, png.toString("base64"));
      const hit = strongestEcho(Uint8Array.from(data), width, height, near && { x: near.x - clip.x, y: near.y - clip.y, radius: near.radius });
      return hit ? { x: clip.x + hit.x, y: clip.y + hit.y, dbz: hit.dbz } : null;
    };

    // ── The workspace ───────────────────────────────────────────────────
    const panes = await Promise.all([0, 1, 2, 3].map(pane));
    const tilt = page.getByLabel("Elevation tilt").first();
    const overviewBoxes = {
      layout: await boxOf(page.getByRole("radiogroup", { name: "Panel layout" })),
      site: await boxOf(page.locator("select").filter({ has: page.locator("option", { hasText: "Nearest (" }) })),
      tools: await boxOf(tools),
      loop: union(await boxOf(page.getByRole("button", { name: "Previous frame" })), await boxOf(clock)),
      frames: union(await boxOf(page.getByLabel("Frames")), await boxOf(page.getByLabel("Speed"))),
      product1: await boxOf(page.getByLabel("Product for panel 1")),
      tilt1: await boxOf(tilt),
      header1: union(await boxOf(page.getByLabel("Product for panel 1")), await boxOf(tilt)),
      settings1: await boxOf(page.getByLabel("Panel 1 settings")),
      p1: panes[0],
      p2: panes[1],
      p3: panes[2],
      p4: panes[3],
      panes: union(...panes),
      side: await boxOf(aside),
      readout: await boxOf(readoutBar),
      tb: await boxOf(page.getByText("TB", { exact: true })),
      navPro: await boxOf(page.getByRole("navigation", { name: "Operating mode" }).getByText(/^(Professional Mode|Pro)$/)),
    };
    await shoot("overview", overviewBoxes);

    const products = await page.getByLabel("Product for panel 1").evaluate((el) =>
      [...(el as HTMLSelectElement).querySelectorAll("optgroup")].map((g) => ({ group: g.label, items: [...g.querySelectorAll("option")].map((o) => o.textContent?.trim() ?? "") })),
    );

    // ── Layouts ─────────────────────────────────────────────────────────
    const layouts = page.getByRole("radiogroup", { name: "Panel layout" });
    for (const l of ["1x1", "3x3"]) {
      await layouts.getByRole("radio", { name: l }).click();
      await page.waitForTimeout(l === "3x3" ? 9_000 : 4_000);
      await page.mouse.move(800, 20);
      await shoot(`layout-${l}`, { layout: await boxOf(layouts), panes: union(...(await Promise.all(Array.from({ length: 9 }, (_, i) => pane(i))))) });
    }
    await layouts.getByRole("radio", { name: "2x2" }).click();
    await page.waitForTimeout(6_000);

    // ── The cursor readout, over the strongest storm ────────────────────
    const storm = await findStorm();
    log(storm ? `  strongest storm on panel 1: about ${storm.dbz} dBZ at ${storm.x},${storm.y}` : "  no storm of 40 dBZ or more on panel 1");
    const p1 = (await pane(0))!;
    const at = storm ?? { x: p1[0] + p1[2] / 2, y: p1[1] + p1[3] / 2 };
    await page.mouse.move(at.x - 30, at.y - 20);
    await page.mouse.move(at.x, at.y, { steps: 6 });
    await page.waitForTimeout(3_500);
    const ps = await Promise.all([0, 1, 2, 3].map(pane));
    const echo = (i: number): [number, number] => [Math.round(ps[i]![0] + at.x - p1[0]), Math.round(ps[i]![1] + at.y - p1[1])];
    await shoot("readout", { readout: await boxOf(readoutBar), p1: ps[0], panes: union(...ps) }, { cursor: echo(0), cursor2: echo(1), cursor3: echo(2), cursor4: echo(3) });

    // ── Sounding ────────────────────────────────────────────────────────
    await tool("Sounding");
    await gone(page.getByText("Loading the model profile…"), 45_000);
    if (await visible(page.getByRole("img", { name: "Skew-T log-P diagram" }), 10_000)) {
      await page.waitForTimeout(1_000);
      await shoot("sounding", {
        side: await boxOf(aside),
        skewt: await boxOf(page.getByRole("img", { name: "Skew-T log-P diagram" })),
        parcel: await boxOf(page.getByRole("radiogroup", { name: "Parcel" })),
        hodograph: await boxOf(page.getByRole("img", { name: "Hodograph" })),
      });
      // The indices and hodograph sit below the Skew-T.
      await page.getByRole("img", { name: "Hodograph" }).scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(600);
      await shoot("sounding-indices", {
        side: await boxOf(aside),
        indices: union(await boxOf(page.getByText("Shear 0–1 km")), await boxOf(page.getByText("Critical angle"))),
        hodograph: await boxOf(page.getByRole("img", { name: "Hodograph" })),
      });
    } else log("::warning::No sounding (the model profile didn't load).");

    // ── Cross-section through the storm ─────────────────────────────────
    await tool("Cross-section");
    const span = Math.min(110, p1[2] / 3);
    const ax = Math.max(p1[0] + 20, at.x - span), bx = Math.min(p1[0] + p1[2] - 70, at.x + span);
    const a: [number, number] = [Math.round(ax), Math.round(at.y + 25)];
    const b: [number, number] = [Math.round(bx), Math.round(at.y - 25)];
    await page.mouse.click(...a);
    await page.waitForTimeout(700);
    await page.mouse.click(...b);
    if (await visible(page.getByRole("img", { name: "Vertical cross-section" }), 45_000)) {
      await page.mouse.move(800, 20);
      await page.waitForTimeout(1_500);
      await shoot("xsect", { side: await boxOf(aside), xsect: await boxOf(page.getByRole("img", { name: "Vertical cross-section" })), p1: await pane(0) }, { A: a, "A′": b });
    } else log("::warning::No cross-section.");

    // ── Storm vector: the same storm two loop times apart ───────────────
    let vectorDone = false;
    if (storm) {
      await tool("Storm vector");
      const prev = page.getByRole("button", { name: "Previous frame" });
      for (let i = 0; i < 4; i++) await prev.click();
      await page.waitForTimeout(2_500);
      const then = (await findStorm({ x: storm.x, y: storm.y, radius: 70 })) ?? storm;
      await page.mouse.click(then.x, then.y);
      const next = page.getByRole("button", { name: "Next frame" });
      for (let i = 0; i < 4; i++) await next.click();
      await page.waitForTimeout(2_500);
      const now = (await findStorm({ x: then.x, y: then.y, radius: 70 })) ?? storm;
      await page.mouse.click(now.x, now.y);
      await page.mouse.move(800, 20);
      if (await visible(page.getByText("Time of arrival"), 8_000)) {
        vectorDone = true;
        await shoot(
          "vector",
          { side: await boxOf(aside), motion: union(await boxOf(page.getByText("From", { exact: true })), await boxOf(page.getByText("As of", { exact: true }))), arrivals: await boxOf(page.getByText("Time of arrival")) },
          { "1": [Math.round(then.x), Math.round(then.y)], "2": [Math.round(now.x), Math.round(now.y)] },
        );
        // ── Time of arrival: a point down the storm's path ──────────────
        await tool("TOA");
        const dx = now.x - then.x, dy = now.y - then.y, len = Math.hypot(dx, dy) || 1;
        const reach = Math.min(120, p1[2] / 3);
        const tx = Math.round(Math.min(p1[0] + p1[2] - 70, Math.max(p1[0] + 20, now.x + (dx / len) * reach)));
        const ty = Math.round(Math.min(p1[1] + p1[3] - 50, Math.max(p1[1] + 40, now.y + (dy / len) * reach)));
        await page.mouse.click(tx, ty);
        await page.mouse.move(800, 20);
        await page.waitForTimeout(1_500);
        await shoot("toa", { side: await boxOf(aside), arrivals: await boxOf(page.getByText("Time of arrival")), p1: await pane(0) }, { "Point 1": [tx, ty] });
      } else log("::warning::The storm vector didn't take.");
    }
    if (!vectorDone) log("  no storm vector or TOA screens (no storm to track)");

    // ── Warning inspector: click inside the warning at the centre ───────
    if (where.warning) {
      await tool("Inspect");
      const c = (await pane(0))!;
      const [ox, oy] = offsetFromCentre(where, where);
      await page.mouse.click(c[0] + c[2] / 2 + ox, c[1] + c[3] / 2 + oy);
      if (await visible(page.getByRole("heading", { name: "Warning inspector" }), 6_000)) {
        await page.mouse.move(800, 20);
        await page.waitForTimeout(800);
        await shoot("inspector", { side: await boxOf(aside), p1: c });
        await page.keyboard.press("Escape");
      } else log("::warning::Clicking the warning didn't open the inspector.");
    }

    // ── WarnGen ─────────────────────────────────────────────────────────
    await tool("WarnGen");
    if (await visible(page.getByRole("button", { name: /Issue to spotter network/ }), 10_000)) {
      await page.mouse.click(at.x, at.y);
      await page.waitForTimeout(800);
      const from = page.getByLabel("From °"), kt = page.getByLabel("Speed, kt");
      if ((await visible(from, 3_000)) && !(await from.inputValue().catch(() => ""))) {
        await from.fill("240");
        await kt.fill("30");
        await page.getByRole("button", { name: "Set motion" }).click();
      }
      await page.mouse.move(800, 20);
      await page.waitForTimeout(1_500);
      await shoot("warngen", { side: await boxOf(aside), product: await boxOf(page.getByLabel("Product", { exact: true })), p1: await pane(0) });
      await page.getByText("Product text").first().scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(600);
      await shoot("warngen-text", { side: await boxOf(aside), text: await boxOf(page.getByText("Product text").first().locator("..")), issue: await boxOf(page.getByRole("button", { name: /Issue to spotter network/ })) });
    } else log("::warning::WarnGen's form didn't open.");

    // ── Settings: where it's switched on ────────────────────────────────
    await page.goto(`${appUrl.replace(/\/$/, "")}/settings#general`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const toggle = page.getByRole("switch", { name: "Professional mode" });
    if (await visible(toggle, 30_000)) {
      await toggle.scrollIntoViewIfNeeded();
      await page.mouse.move(800, 20);
      await page.waitForTimeout(1_000);
      await shoot("settings", { toggle: await boxOf(toggle), open: await boxOf(page.getByText("Open Pro", { exact: true })) });
    } else log("::warning::No Professional mode switch in Settings.");

    if (errors.length) log(`::warning::The page reported errors: ${errors.slice(0, 3).join("; ")}`);
    return { at: new Date().toISOString(), where, shots, products };
  } finally {
    await browser.close();
  }
}

/** For trying it by hand: `npx tsx shorts/app-capture.ts http://localhost:3000 out.json` (also writes each screen as a JPEG). */
async function main() {
  const [url = "https://www.stormcentralwx.com", out = "shorts/out/pro-screens.json"] = process.argv.slice(2);
  const s = await captureProScreens(url);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(s));
  for (const [id, shot] of Object.entries(s.shots)) writeFileSync(out.replace(/\.json$/, `-${id}.jpg`), Buffer.from(shot.img.split(",")[1]!, "base64"));
  console.log(`Wrote ${out} (${Object.keys(s.shots).length} screens).`);
}
if (process.argv[1]?.endsWith("app-capture.ts"))
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
