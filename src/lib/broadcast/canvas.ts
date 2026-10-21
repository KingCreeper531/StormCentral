/**
 * Broadcast graphics drawn into exported video and GIF frames
 * (lib/radar/export-loop's `overlay`): the station bug, the radar frame's
 * time where the on-screen clock sits, the lower third and a still ticker.
 * Laid out for a 1280 px wide frame and scaled to the export's width, in the
 * same colours as the on-screen graphics (components/broadcast).
 */
import type { LowerThird, TickerItem } from "./graphics";

export interface BroadcastFrame {
  name: string;
  tagline: string;
  live: boolean;
  accent: string;
  /** The station logo, already decoded. */
  logo: CanvasImageSource | null;
  parts: { bug: boolean; clock: boolean; lower: boolean; ticker: boolean };
  lower: LowerThird;
  ticker: readonly TickerItem[];
  /** Small caps label over the frame time ("RADAR", or "HRRR FORECAST" for a forecast frame). */
  timeLabel: string;
  tickerLabel: string;
  liveLabel: string;
}

const PANEL_TOP = "rgba(14, 20, 36, 0.95)";
const PANEL_BOTTOM = "rgba(7, 11, 22, 0.95)";
const INK = "#f4f6fb";
const MUTED = "#9aa4b8";
const SOFT = "#cfd5e2";

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, PANEL_TOP);
  g.addColorStop(1, PANEL_BOTTOM);
  rounded(ctx, x, y, w, h, r);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.09)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Text cut with an ellipsis to fit `max` px. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

/**
 * Draw the graphics over a frame `w`×`h` px. `time` is the radar frame's
 * clock time ("5:42 PM"), `date` its date.
 */
export function drawBroadcast(ctx: CanvasRenderingContext2D, w: number, h: number, g: BroadcastFrame, time: string, date: string, fontFamily: string) {
  const s = w / 1280;
  const px = (n: number) => Math.round(n * s);
  const font = (weight: number, size: number) => `${weight} ${Math.max(8, px(size))}px ${fontFamily}`;
  const m = px(18);
  ctx.save();
  ctx.textBaseline = "alphabetic";

  const tickerH = g.parts.ticker ? px(36) : 0;

  if (g.parts.bug) {
    const bh = px(56);
    ctx.font = font(800, 17);
    const nameW = ctx.measureText(g.name.toUpperCase()).width;
    ctx.font = font(600, 11.5);
    const tagW = g.tagline ? ctx.measureText(g.tagline).width : 0;
    const liveW = g.live ? px(58) : 0;
    const bw = Math.min(w * 0.55, px(58) + Math.max(nameW, liveW + (tagW ? px(8) + tagW : 0)) + px(16));
    panel(ctx, m, px(16), bw, bh, px(14));
    if (g.logo) ctx.drawImage(g.logo, m + px(8), px(16) + px(8), px(40), px(40));
    const tx = m + px(58);
    ctx.fillStyle = INK;
    ctx.font = font(800, 17);
    ctx.fillText(fit(ctx, g.name.toUpperCase(), bw - px(66)), tx, px(16) + px(25));
    let x = tx;
    const row = px(16) + px(45);
    if (g.live) {
      rounded(ctx, x, row - px(13), px(52), px(17), px(5));
      ctx.fillStyle = g.accent;
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(x + px(10), row - px(4.5), px(3.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.font = font(800, 11);
      ctx.fillText(g.liveLabel, x + px(17), row);
      x += px(60);
    }
    if (g.tagline) {
      ctx.font = font(600, 11.5);
      ctx.fillStyle = MUTED;
      ctx.fillText(fit(ctx, g.tagline, bw - (x - m) - px(10)), x, row);
    }
  }

  if (g.parts.clock) {
    const cw = px(236);
    const cx = w - m - cw;
    panel(ctx, cx, px(16), cw, px(62), px(14));
    ctx.font = font(800, 10.5);
    ctx.fillStyle = MUTED;
    ctx.fillText(g.timeLabel, cx + px(14), px(16) + px(17));
    ctx.font = font(800, 24);
    ctx.fillStyle = INK;
    ctx.fillText(fit(ctx, time, cw - px(28)), cx + px(14), px(16) + px(43));
    ctx.font = font(600, 11.5);
    ctx.fillStyle = MUTED;
    ctx.fillText(fit(ctx, date, cw - px(28)), cx + px(14), px(16) + px(57));
  }

  if (g.parts.lower) {
    const lh = px(78);
    const ly = h - tickerH - px(g.parts.ticker ? 10 : 18) - lh;
    panel(ctx, m, ly, w - m * 2, lh, px(14));
    ctx.save();
    rounded(ctx, m, ly, w - m * 2, lh, px(14));
    ctx.clip();
    ctx.fillStyle = g.lower.color;
    ctx.fillRect(m, ly, px(10), lh);
    ctx.restore();
    const inner = w - m * 2 - px(46);
    ctx.font = font(900, 27);
    ctx.fillStyle = INK;
    ctx.fillText(fit(ctx, g.lower.title, inner), m + px(28), ly + px(37));
    ctx.font = font(600, 16.5);
    ctx.fillStyle = SOFT;
    ctx.fillText(fit(ctx, g.lower.subtitle, inner), m + px(28), ly + px(62));
  }

  if (g.parts.ticker) {
    const ty = h - tickerH;
    ctx.fillStyle = "#050810";
    ctx.fillRect(0, ty, w, tickerH);
    ctx.font = font(900, 12);
    const labW = ctx.measureText(g.tickerLabel).width + px(28);
    ctx.fillStyle = g.accent;
    ctx.fillRect(0, ty, labW, tickerH);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(g.tickerLabel, px(14), ty + px(23));
    let x = labW + px(14);
    for (const it of g.ticker) {
      if (x > w - px(40)) break;
      ctx.font = font(900, 11);
      const cw = ctx.measureText(it.code).width + px(12);
      rounded(ctx, x, ty + px(9), cw, px(18), px(4));
      ctx.fillStyle = it.color;
      ctx.fill();
      ctx.fillStyle = "#0a0d14";
      ctx.fillText(it.code, x + px(6), ty + px(22));
      x += cw + px(8);
      ctx.font = font(600, 15);
      ctx.fillStyle = "#e8ecf4";
      const text = fit(ctx, it.text, w - x - px(16));
      ctx.fillText(text, x, ty + px(24));
      x += ctx.measureText(text).width + px(34);
    }
  }
  ctx.restore();
}
