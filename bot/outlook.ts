/**
 * The morning severe weather outlook post: SPC's Day 1 Convective Outlook
 * (the SWODY1 text, via the NWS API) read and worded for X. Pure functions;
 * main.ts does the fetching and decides when to post.
 */
import { MAX_POST, SITE, weightedLength } from "./select";

/** SPC's categorical risks, lowest first; the index is the "level N of 5". */
export const RISKS = ["MARGINAL", "SLIGHT", "ENHANCED", "MODERATE", "HIGH"] as const;
export type Risk = (typeof RISKS)[number];

export interface Outlook {
  /** "141300Z": day of month and issuance cycle the outlook is valid from. */
  validFrom: string;
  /** The cycle, "1300" for the morning outlook (also 0600, 1630, 2000, 0100). */
  cycle: string;
  /** The highest risk in the outlook, or null when no severe storms are forecast. */
  risk: Risk | null;
  /** The SUMMARY paragraph, unwrapped ("" when there is none). */
  summary: string;
}

/** The map SPC publishes with each Day 1 cycle. */
export const outlookImageUrl = (cycle: string) => `https://www.spc.noaa.gov/products/outlook/day1otlk_${cycle}.png`;

const unwrap = (s: string) => s.replace(/\s+/g, " ").trim();

/** Reads the SWODY1 product text; null when it isn't a Day 1 outlook. */
export function parseOutlook(text: string): Outlook | null {
  const valid = /Valid\s+(\d{2})(\d{4})Z\s*-\s*\d{6}Z/.exec(text);
  if (!valid || !/Day 1 Convective Outlook/i.test(text)) return null;

  // "...THERE IS A SLIGHT RISK OF SEVERE THUNDERSTORMS ACROSS ..." (one per risk area, highest first, but take the max anyway).
  let level = -1;
  for (const m of unwrap(text).matchAll(/THERE IS AN? (MARGINAL|SLIGHT|ENHANCED|MODERATE|HIGH) RISK OF SEVERE/g)) {
    level = Math.max(level, RISKS.indexOf(m[1] as Risk));
  }

  // The paragraph after "...SUMMARY...", up to the next blank line or section header.
  const summary = /\.\.\.SUMMARY\.\.\.\s*\n([\s\S]*?)(?:\n\s*\n|\n\s*\.\.\.|$)/.exec(text);
  return {
    validFrom: `${valid[1]}${valid[2]}Z`,
    cycle: valid[2]!,
    risk: level >= 0 ? RISKS[level]! : null,
    summary: summary ? unwrap(summary[1]!) : "",
  };
}

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/** "Enhanced Risk (level 3 of 5)", or "no severe storms expected". */
export function riskText(risk: Risk | null): string {
  return risk ? `${titleCase(risk)} Risk (level ${RISKS.indexOf(risk) + 1} of 5)` : "no severe storms expected";
}

/** Sentences of the summary that fit in `room` characters (cut at a word when even the first doesn't). */
function fitSummary(summary: string, room: number): string {
  if (summary.length <= room) return summary;
  const sentences = summary.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)?.map((s) => s.trim()) ?? [summary];
  let out = "";
  for (const s of sentences) {
    const next = out ? `${out} ${s}` : s;
    if (next.length > room) break;
    out = next;
  }
  if (out) return out;
  const cut = summary.slice(0, room - 2); // "…" counts 2
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1))}…`;
}

/**
 * The post: the day's highest risk, SPC's summary of where and what, the
 * source and (with `links`) a link to Storm Central. Always ≤ 280.
 *
 *   Today's severe weather outlook: Slight Risk (level 2 of 5)
 *
 *   Thunderstorms with severe wind gusts and some tornado threat are possible ...
 *
 *   Source: NOAA Storm Prediction Center #severewx
 *   https://storm-central-pi.vercel.app/?mode=severe
 */
export function composeOutlookPost(o: Outlook, { links = true }: { links?: boolean } = {}): string {
  const head = `Today's severe weather outlook: ${riskText(o.risk)}`;
  const tail = ["Source: NOAA Storm Prediction Center #severewx", links ? `${SITE}/?mode=severe` : ""].filter(Boolean).join("\n");
  const fixed = weightedLength(`${head}\n\n\n\n${tail}`);
  const summary = o.summary ? fitSummary(o.summary, MAX_POST - fixed) : "";
  const text = [head, summary, tail].filter(Boolean).join("\n\n");
  return weightedLength(text) <= MAX_POST ? text : [head, tail].join("\n\n");
}
