/**
 * SPC's Day 1 Convective Outlook (the SWODY1 text, via the NWS API), read
 * into its risk and summary. Pure functions; the Shorts do the fetching.
 */

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
