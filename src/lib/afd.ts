/**
 * NWS Area Forecast Discussion (AFD) → readable notes. The AFD is the local
 * forecasters' own write-up of their reasoning; it is written for other
 * meteorologists, so this splits it into sections, unwraps the fixed-width
 * text, spells out shorthand and picks the plain-language summary (the
 * office's key messages where it writes them, otherwise the synopsis).
 */

export interface AfdSection {
  /** Lower-case slug of the heading, e.g. "short-term". */
  id: string;
  /** Sentence-case heading: "Short term". */
  title: string;
  /** The period it covers, when given: "Tonight through Tuesday night". */
  period: string | null;
  /** Aviation, marine, fire weather and the like: shown after the forecast sections. */
  specialty: boolean;
  paragraphs: string[];
}

export interface AfdSummary {
  kind: "key-messages" | "synopsis" | "discussion";
  items: string[];
}

export interface ParsedAfd {
  /** "Pittsburgh PA" (from "National Weather Service Pittsburgh PA"). */
  officeName: string | null;
  summary: AfdSummary | null;
  /** Office-reported change since the last issuance ("What has changed"), when given. */
  changes: string[];
  sections: AfdSection[];
  glossary: GlossaryEntry[];
}

export interface GlossaryEntry {
  term: string;
  meaning: string;
}

const SPECIALTY = /^(AVIATION|MARINE|FIRE WEATHER|HYDROLOGY|CLIMATE|TIDES|COASTAL|BEACHES|EQUIPMENT|AIR QUALITY|RIP CURRENTS|SURF|SHORT TERM TEMPS)/;
/** The office's active-alert list (the app already shows alerts) and point-forecast tables (unreadable unwrapped). */
const SKIP = /WATCHES\/WARNINGS|WARNINGS\/ADVISORIES|^[A-Z]{3} WATCHES|PRELIMINARY POINT|POINT TEMPS/;

/** Office shorthand → plain words (whole words only; case-insensitive unless all-caps). */
const SHORTHAND: [RegExp, string][] = [
  [/\bcigs\b/gi, "cloud ceilings"],
  [/\bvsbys?\b/gi, "visibility"],
  [/\btstms?\b/gi, "thunderstorms"],
  [/\bshra\b/gi, "rain showers"],
  [/\bpops\b/gi, "rain chances"],
  [/\bfropa\b/gi, "the front passing"],
  [/\bsfc\b/gi, "surface"],
  [/\bkts\b/gi, "knots"],
  [/\bkt\b/g, "knots"],
  [/\btemps\b/gi, "temperatures"],
  [/\bprecip\b/gi, "precipitation"],
  [/\bwx\b/gi, "weather"],
  [/\bwaa\b/gi, "warm air moving in"],
  [/\bcaa\b/gi, "cold air moving in"],
  [/\bllj\b/gi, "low-level jet"],
  [/\bqpf\b/gi, "rainfall amounts"],
  [/\bcwa\b/gi, "forecast area"],
  [/\bmin(?:imum)? rh\b/gi, "lowest humidity"],
  [/\brh\b/gi, "humidity"],
  [/\bdeg\b/gi, "degrees"],
  [/\bpcpn\b/gi, "precipitation"],
  [/\bwk\b/gi, "week"],
  [/\bthru\b/gi, "through"],
  [/\bnr\b/gi, "near"],
];

/** Terms explained in the jargon decoder, matched case-insensitively against the text. */
export const GLOSSARY: { match: RegExp; term: string; meaning: string }[] = [
  { match: /\bshort ?waves?\b/i, term: "Shortwave", meaning: "A small ripple in the upper-level winds that can trigger clouds, rain or storms as it passes." },
  { match: /\btrough(?:s|ing)?\b/i, term: "Trough", meaning: "A dip in the upper-level winds: usually cooler, unsettled weather." },
  { match: /\bridg(?:e|es|ing)\b/i, term: "Ridge", meaning: "A bulge in the upper-level winds: usually warm, dry and calm weather." },
  { match: /\b(?:upper|cut-?off) low\b/i, term: "Upper low", meaning: "A storm spinning high in the atmosphere; brings clouds, showers and cooler air, and can be slow to move." },
  { match: /\bheight (?:rises|falls)\b/i, term: "Height rises / falls", meaning: "The atmosphere warming and expanding (rises, usually fair weather) or cooling and shrinking (falls, usually unsettled)." },
  { match: /\bdam\b/, term: "dam", meaning: "Decameters (10 m). Used for the height of pressure levels; higher means warmer air." },
  { match: /\b(?:500|700|850|925|250|300) ?(?:mb|hpa)\b/i, term: "500 mb, 850 mb …", meaning: "Pressure levels used as heights: 850 mb is about 1.5 km up, 500 mb about 5.5 km, 250 mb near jet-stream level." },
  { match: /\badvection\b/i, term: "Advection", meaning: "Air being carried in by the wind: warm advection warms things up, cold advection cools them down." },
  { match: /\bsubsidence\b/i, term: "Subsidence", meaning: "Sinking air. It dries and warms as it sinks, which clears skies and stops rain." },
  { match: /\binversion\b/i, term: "Inversion", meaning: "A layer where temperature rises with height. It traps fog, haze and smoke near the ground and can cap storms." },
  { match: /\bcape\b/i, term: "CAPE", meaning: "Fuel for thunderstorms (how much energy rising air can gain). Over 1000 J/kg is plenty for strong storms." },
  { match: /\b(?:wind )?shear\b/i, term: "Shear", meaning: "Winds changing speed or direction with height. With instability it lets storms organise and rotate." },
  { match: /\binstability\b|\bunstable\b/i, term: "Instability", meaning: "How easily air keeps rising once it starts, the key ingredient for thunderstorms." },
  { match: /\bconvect(?:ion|ive)\b/i, term: "Convection", meaning: "Rising air that builds showers and thunderstorms." },
  { match: /\bmcs\b|\bmesoscale convective/i, term: "MCS", meaning: "A large, organised cluster or line of thunderstorms that can last for hours and cover hundreds of miles." },
  { match: /\bdew ?points?\b/i, term: "Dew point", meaning: "A measure of moisture in the air. Above about 65 °F (18 °C) feels muggy and feeds storms." },
  { match: /\bpwats?\b|precipitable water/i, term: "PWAT", meaning: "Precipitable water: how much moisture is in the air above you. High values mean heavy downpours are possible." },
  { match: /\blapse rates?\b/i, term: "Lapse rate", meaning: "How fast temperature drops with height. Steep lapse rates mean more unstable air." },
  { match: /\bsynoptic\b/i, term: "Synoptic", meaning: "Large scale: the weather systems you'd see on a national map." },
  { match: /\bmesoscale\b/i, term: "Mesoscale", meaning: "Small scale, a few to a few hundred miles: individual storms, sea breezes, lake-effect bands." },
  { match: /\bensembles?\b/i, term: "Ensemble", meaning: "Many runs of a forecast model with slightly different starts. Agreement between them means more confidence." },
  { match: /\bdeterministic\b/i, term: "Deterministic", meaning: "A single model run (as opposed to an ensemble of many)." },
  { match: /\bcluster analysis\b/i, term: "Cluster analysis", meaning: "Grouping ensemble members into a few likely scenarios." },
  { match: /\bnbm\b/i, term: "NBM", meaning: "National Blend of Models: the NWS's statistical blend of many models, the starting point for most forecasts." },
  { match: /\bgfs\b/i, term: "GFS", meaning: "The main US global weather model." },
  { match: /\b(?:ecmwf|euro)\b/i, term: "ECMWF / Euro", meaning: "The European global weather model." },
  { match: /\bnam\b/i, term: "NAM", meaning: "A US regional model covering North America." },
  { match: /\bhrrr\b/i, term: "HRRR", meaning: "High-Resolution Rapid Refresh: an hourly-updating US model good at individual storms over the next 18–48 hours." },
  { match: /\bhref\b|\bcams?\b(?! ?\()/, term: "CAMs / HREF", meaning: "High-resolution models that try to show individual thunderstorms; HREF is a blend of several." },
  { match: /\bfrontogenesis\b/i, term: "Frontogenesis", meaning: "A front forming or strengthening, which often focuses a band of rain or snow." },
  { match: /\bisentropic\b/i, term: "Isentropic lift", meaning: "Air gliding up and over colder air ahead of a warm front, giving widespread light rain or snow." },
  { match: /\btheta-?e\b/i, term: "Theta-e", meaning: "A combined measure of heat and moisture; high values mark the air that fuels storms." },
  { match: /\bdiurnal(?:ly)?\b/i, term: "Diurnal", meaning: "Following the daily cycle: e.g. showers that pop up with afternoon heating and fade at night." },
  { match: /\boffshore (?:flow|winds?|gradients?)\b/i, term: "Offshore flow", meaning: "Wind blowing from land out to sea; on the West Coast it brings hot, dry, gusty weather." },
  { match: /\bsanta ana\b/i, term: "Santa Ana winds", meaning: "Hot, very dry, gusty winds blowing from the deserts toward the Southern California coast. A major fire danger." },
  { match: /\blake[- ]effect\b|\blake[- ]enhanced\b/i, term: "Lake effect", meaning: "Cold air crossing warmer lake water picks up moisture and drops narrow, intense bands of snow or rain downwind." },
  { match: /\bmvfr\b|\bifr\b|\bvfr\b/i, term: "VFR / MVFR / IFR", meaning: "Aviation flying categories from good (VFR) to poor (IFR), based on cloud height and visibility." },
  { match: /\btafs?\b/i, term: "TAF", meaning: "Terminal Aerodrome Forecast: the official airport weather forecast." },
  { match: /\bsca\b|small craft advisory/i, term: "Small Craft Advisory", meaning: "Winds or waves hazardous to small boats." },
  { match: /\bpops?\b|probability of precipitation/i, term: "PoP", meaning: "Probability of precipitation: the chance of measurable rain or snow at a point." },
  { match: /\bqpf\b/i, term: "QPF", meaning: "Quantitative precipitation forecast: the expected rain or melted snow total." },
  { match: /\bomega block\b|\bblocking\b|\bblock(?:ed)? pattern\b/i, term: "Blocking pattern", meaning: "A stuck upper-level pattern that keeps the same weather around for days." },
  { match: /\bjet (?:streak|stream)\b/i, term: "Jet stream", meaning: "The fast river of air 30,000–40,000 ft up that steers storms." },
  { match: /\bstationary front\b|\bstall(?:ed|s|ing)? (?:out )?(?:front|boundary)\b|\bfront\b.{0,30}\bstall/i, term: "Stalled front", meaning: "A front that stops moving; rain can repeat over the same area along it." },
  { match: /\bmixing\b/i, term: "Mixing", meaning: "Daytime heating stirring the lowest few thousand feet, which brings stronger winds aloft down to the ground and dries the air." },
  { match: /\bverif(?:y|ication)\b|\bmos\b/i, term: "MOS", meaning: "Model Output Statistics: model forecasts corrected for each location's known biases." },
];

const ALL_CAPS = /^[^a-z]*[A-Z][^a-z]*$/;

/** Fixed-width lines → paragraphs; old all-caps products become sentence case. */
function toParagraphs(lines: string[]): string[] {
  const paras: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length) paras.push(cur.join(" ").replace(/\s+/g, " ").trim());
    cur = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    // Update / previous-discussion banners split paragraphs but carry no content.
    if (!line || /^\*{2,}.*\*{2,}$/.test(line) || /^-{3,}$/.test(line)) {
      flush();
      continue;
    }
    // A new bullet or numbered item starts a new paragraph even without a blank line.
    if (/^(?:[-*•]\s|\d{1,2}[).]\s)/.test(line)) flush();
    cur.push(line);
  }
  flush();
  return paras.filter(Boolean).map(plain);
}

const PROPER = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|june|july|august|september|october|november|december)\b/g;

function sentenceCase(s: string) {
  const lower = s.toLowerCase().replace(PROPER, (w) => w[0]!.toUpperCase() + w.slice(1));
  return lower.replace(/(^\s*|[.!?]\s+)([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase()).replace(/\b(\d{1,2})z\b/g, "$1Z");
}

/** Spell out shorthand and fix all-caps text (still issued by a few offices). */
export function plain(s: string): string {
  let t = ALL_CAPS.test(s) && s.length > 30 ? sentenceCase(s) : s;
  // Keep a capital where the shorthand started a sentence ("Tstms" → "Thunderstorms").
  for (const [re, word] of SHORTHAND) t = t.replace(re, (m: string) => (/^[A-Z][a-z]/.test(m) ? word.charAt(0).toUpperCase() + word.slice(1) : word));
  return t.replace(/\.{3,}/g, "…").replace(/\s+([,.;:])/g, "$1");
}

const stripBullet = (s: string) => s.replace(/^(?:[-*•]\s+|\d{1,2}[).]\s+)/, "").trim();

const TITLE_FIX: Record<string, string> = {
  "WHAT HAS CHANGED": "What's changed",
  "KEY MESSAGES": "Key messages",
  "TIDES/COASTAL FLOODING": "Tides and coastal flooding",
};

const SHORT_DAY: Record<string, string> = { TDY: "Today", TODAY: "Today", TNGT: "Tonight", TNT: "Tonight", TONIGHT: "Tonight" };

/** "TDY-WED" → "Today to Wed". */
function shortPeriod(p: string): string {
  return p
    .split("-")
    .map((w) => SHORT_DAY[w.toUpperCase()] ?? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" to ");
}

function heading(raw: string): { title: string; period: string | null } {
  const m = raw.match(/^(.*?)\s*[/(](.+?)[/)]\s*$/);
  const base = (m ? m[1]! : raw).trim();
  const periodRaw = m ? m[2]!.trim() : null;
  const title = TITLE_FIX[base] ?? sentenceCase(base);
  // "(TDY-WED)" is shorthand; "/TONIGHT THROUGH TUESDAY NIGHT/" reads fine in sentence case.
  const period = !periodRaw ? null : periodRaw.includes(" ") ? sentenceCase(periodRaw) : shortPeriod(periodRaw);
  return { title, period };
}

/** ".SHORT TERM /Through Wednesday Night/...": capitals first; the period part may be mixed case. */
const SECTION = /^\.([A-Z][A-Z0-9 &'-]*(?:\s*[/(][^.]*?[/)])?)\s*\.\.\.(.*)$/;
/** "11/345 PM.", "12/1757Z.", "Issued at 1050 AM CDT Mon Oct 12 2026", "1258 PM EDT" after a heading. */
const STAMP = /^(?:issued at\s+)?(?:\d{1,2}\/)?\d{3,4}\s*(?:Z|AM|PM)?(?:\s+[A-Z]{3,4})?(?:\s+\w{3}\s+\w{3}\s+\d{1,2}\s+\d{4})?\.?\s*/i;

export function parseAfd(text: string): ParsedAfd {
  const lines = text.replace(/\r/g, "").split("\n");
  const officeLine = lines.find((l) => /^National Weather Service /i.test(l.trim()));
  const officeName = officeLine ? officeLine.trim().replace(/^National Weather Service\s+/i, "") : null;

  const sections: AfdSection[] = [];
  let cur: { head: string; body: string[] } | null = null;
  const close = () => {
    if (!cur) return;
    const { head, body } = cur;
    cur = null;
    if (SKIP.test(head)) return;
    const kept = body.filter((l) => !/^\s*(?:issued|updated)(?: at)? \d{3,4}\s*(?:AM|PM|Z)/i.test(l));
    let paragraphs = toParagraphs(kept);
    // Some offices put the period on its own line: "(Rest of today and tonight)".
    let periodLine: string | null = null;
    const lead = paragraphs[0]?.match(/^\(([^()]{3,60})\)$/);
    if (lead) {
      periodLine = lead[1]!;
      paragraphs = paragraphs.slice(1);
    }
    if (!paragraphs.length) return;
    const h = heading(head);
    const title = h.title;
    const period = h.period ?? (periodLine ? sentenceCase(periodLine) : null);
    const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    sections.push({ id, title, period, specialty: SPECIALTY.test(head), paragraphs });
  };

  for (const line of lines) {
    const t = line.trimEnd();
    const m = t.match(SECTION);
    if (m) {
      close();
      const rest = m[2]!.trim().replace(STAMP, "").trim();
      cur = { head: m[1]!.trim(), body: rest ? [rest] : [] };
      continue;
    }
    if (/^(?:&&|\$\$)\s*$/.test(t.trim())) {
      close();
      continue;
    }
    cur?.body.push(t);
  }
  close();

  // Sections an office repeats ("Discussion" under "Update") read once, in order.
  const byId = new Map<string, AfdSection>();
  for (const s of sections) {
    const prev = byId.get(s.id);
    if (prev) prev.paragraphs.push(...s.paragraphs);
    else byId.set(s.id, s);
  }
  const unique = [...byId.values()];

  const changesSec = unique.find((s) => s.id === "what-s-changed");
  const changes = changesSec ? changesSec.paragraphs.map(stripBullet) : [];
  const forecastSections = unique.filter((s) => s !== changesSec);

  const key = forecastSections.find((s) => s.id === "key-messages");
  const synopsis = forecastSections.find((s) => s.id === "synopsis");
  const first = forecastSections.find((s) => !s.specialty && s !== key && s !== synopsis);
  // Key-message items sometimes carry a "KEY MESSAGE 1..." sub-heading in the discussion; not here.
  const summary: AfdSummary | null = key
    ? { kind: "key-messages", items: key.paragraphs.map(stripBullet).filter((p) => p.length > 3) }
    : synopsis
      ? { kind: "synopsis", items: synopsis.paragraphs.slice(0, 3) }
      : first
        ? { kind: "discussion", items: first.paragraphs.slice(0, 2) }
        : null;

  return {
    officeName,
    summary,
    changes,
    // The summary's own section isn't repeated in the full discussion.
    sections: forecastSections.filter((s) => s !== key && !(summary?.kind === "synopsis" && s === synopsis)).map((s) => ({ ...s, paragraphs: s.paragraphs.map((p) => p.replace(/^KEY MESSAGE \d+\s*…\s*/i, "")) })),
    glossary: glossaryFor(unique.flatMap((s) => s.paragraphs).join(" ")),
  };
}

/** Jargon in the text, in glossary order (at most `max`). */
export function glossaryFor(text: string, max = 14): GlossaryEntry[] {
  const out: GlossaryEntry[] = [];
  for (const g of GLOSSARY) {
    if (out.length >= max) break;
    if (g.match.test(text)) out.push({ term: g.term, meaning: g.meaning });
  }
  return out;
}
