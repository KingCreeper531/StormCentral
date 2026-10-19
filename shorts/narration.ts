/**
 * What the narrator says in each Short: lines ("cues") timed to the scenes of
 * its page, written from the same DATA the page draws, so the voice matches
 * the screen. The end card stays silent. voice.ts speaks and mixes them.
 */
import type { Video } from "./video";

export interface Cue {
  /** When the line should start, in seconds (pushed later if the one before runs long). */
  at: number;
  text: string;
  /** The plain line, when `text` is the AI narrator's rewrite of it (script.ts). */
  plain?: string;
}

export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "D.C.", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
};
const DAYS: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
const POINTS: Record<string, string> = { N: "north", E: "east", S: "south", W: "west" };
/** "NNW" → "north-northwest". */
const compassWords = (dir: string) => {
  const w = (d: string) => [...d].map((c) => POINTS[c]).join("");
  return dir.length === 3 ? `${w(dir[0]!)}-${w(dir.slice(1))}` : w(dir);
};

/** Text as it should be read aloud: units, state codes, short day names and compass points spelled out. */
export function spoken(s: string): string {
  return s
    .replace(/\b(\d+(?:\.\d+)?)(?:"| in\b(?=[,.;]|$))/g, (_, n: string) => `${n} ${Number(n) === 1 ? "inch" : "inches"}`)
    .replace(/\bmph\b/g, "miles per hour")
    .replace(/(\d)%/g, "$1 percent")
    .replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b\.?/g, (d: string) => DAYS[d.replace(".", "")]!)
    .replace(/\b([NSEW]{1,3})(?= at \d)/g, (dir: string) => compassWords(dir))
    .replace(/\b[A-Z]{2}\b/g, (code) => STATE_NAMES[code] ?? code)
    .replace(/\s+/g, " ")
    .trim();
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const join = (parts: string[]) => (parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`);

/** The first sentences of SPC's summary that fit in about six seconds of speech. */
function firstSentences(s: string, room = 150) {
  let out = "";
  for (const x of s.match(/[^.!?]+[.!?]+/g) ?? [s]) {
    if (out && (out + x).length > room) break;
    out += x;
  }
  return out.trim();
}

type Fc = { features: { properties: { LABEL?: string } }[] };
const maxProb = (fc: Fc) => Math.round(Math.max(0, ...fc.features.map((f) => Number(f.properties.LABEL)).filter((n) => !Number.isNaN(n))) * 100);

interface OutlookData { outlook: { risk: string | null; level: number; region: string; summary: string; date: string }; torn: Fc; wind: Fc; hail: Fc }
interface RecapData { date: string; counts: { tornado: number; wind: number; hail: number }; highlights: { label: string; value: string; place: string }[] }
type WeekDay = { short: string; code: string | null; prob: number; level: number; risk: string };
interface WeeklyData { days: WeekDay[] }
interface TropicalData {
  storm: { title: string; stage: string; windMph: number | null; moving: string | null; ahead: string | null; forecast: { stage: string; windMph: number | null; when: string }[] };
}

// Timings follow the pages: outlook.html, recap.html, weekly.html and tropical.html.

function outlook(d: OutlookData): Cue[] {
  const o = d.outlook;
  const [torn, wind, hail] = [maxProb(d.torn), maxProb(d.wind), maxProb(d.hail)];
  return [
    { at: 0.4, text: `Here's your severe weather outlook for ${o.date}.` },
    { at: 4.0, text: o.risk ? `The top risk today is a ${o.risk} Risk, level ${o.level} of 5${o.region ? `, for the ${o.region}` : ""}.` : "No severe storms are expected today." },
    { at: 10.2, text: torn ? `The tornado threat peaks at ${torn} percent.` : "Tornadoes aren't expected." },
    { at: 13.6, text: wind ? `Damaging winds, up to ${wind} percent.` : "Damaging winds aren't expected." },
    { at: 17.0, text: hail ? `And large hail, up to ${hail} percent.` : "And large hail isn't expected." },
    { at: 20.6, text: firstSentences(o.summary) },
  ];
}

function recap(d: RecapData): Cue[] {
  const c = d.counts;
  const total = c.tornado + c.wind + c.hail;
  const kinds = [
    c.tornado && plural(c.tornado, "tornado report", "tornado reports"),
    c.wind && plural(c.wind, "damaging wind report", "damaging wind reports"),
    c.hail && plural(c.hail, "large hail report", "large hail reports"),
  ].filter((x): x is string => !!x);
  const hl = d.highlights;
  return [
    { at: 0.4, text: `Here are the storm reports for ${d.date}.` },
    { at: 5.2, text: `${plural(total, "severe weather report", "severe weather reports")} came in: ${join(kinds)}.` },
    ...hl.map((h, i) => ({
      at: 16.7 + i * 3.3,
      text: h.label === "Tornado reports" ? `Tornado reports came from ${h.place}.` : `${h.label}: ${h.value}, near ${h.place}.`,
    })),
  ];
}

function weekly(d: WeeklyData): Cue[] {
  const days = d.days;
  const DAY0 = 3.4, EACH = 2.4, SUM0 = DAY0 + days.length * EACH + 0.2;
  const busiest = days.reduce<WeekDay | null>((b, x) => (x.level > (b?.level ?? 0) ? x : b), null);
  const name = (x: WeekDay) => DAYS[x.short] ?? x.short;
  const risk = (x: WeekDay) => (x.code ? x.risk.replace(/ \(\d of 5\)/, "") : x.prob ? `a ${x.prob} percent chance` : "quiet");
  return [
    { at: 0.4, text: "Here's the severe weather outlook for the week ahead." },
    ...days.map((x, i) => ({ at: DAY0 + i * EACH + 0.1, text: `${name(x)}, ${risk(x)}.` })),
    { at: SUM0 + 0.2, text: busiest ? `The most active day looks like ${name(busiest)}, with ${busiest.code ? `a ${risk(busiest)}` : risk(busiest)}.` : "Overall, it looks like a quiet week." },
  ];
}

function tropical(d: TropicalData): Cue[] {
  const s = d.storm;
  const fc = s.forecast;
  const last = fc.at(-1);
  const a = (stage: string) => `${/^[aeiou]/i.test(stage) ? "an" : "a"} ${stage.replace(/^(Tropical|Subtropical|Post-tropical)/, (w) => w.toLowerCase())}`;
  return [
    { at: 0.4, text: `Here's the latest on ${s.title}.` },
    { at: 5.0, text: s.windMph != null ? `It's ${a(s.stage)} with maximum winds of ${s.windMph} mph${s.moving ? `, moving ${s.moving}` : ""}.` : `It's ${a(s.stage)}.` },
    ...(s.ahead ? [{ at: 9.6, text: `It's ${s.ahead.charAt(0).toLowerCase()}${s.ahead.slice(1)}.` }] : []),
    ...(last?.stage ? [{ at: 14.7, text: `By ${last.when}, it's forecast to be ${a(last.stage)}${last.windMph != null ? ` with ${last.windMph} mph winds` : ""}.` }] : []),
  ];
}

// Each page's DATA, as its kind builds it.
interface FireData {
  count: number;
  fire: { name: string; state: string; acres: number; contained: number | null; growth: number | null; personnel: number | null; days: number | null };
}

function fire(d: FireData): Cue[] {
  const f = d.fire;
  const later = [
    f.growth ? `That's ${f.growth.toLocaleString("en-US")} more acres than yesterday.` : f.days != null ? `It has been burning for ${f.days} days.` : null,
    f.personnel ? `About ${f.personnel.toLocaleString("en-US")} firefighters and support crew are working on it.` : null,
  ].filter((x): x is string => !!x);
  return [
    { at: 0.4, text: `Here's the latest on the ${f.name} in ${f.state}.` },
    { at: 3.9, text: d.count === 1 ? "One large wildfire is burning in the U.S. right now." : `${d.count} large wildfires are burning in the U.S. right now.` },
    { at: 8.8, text: `It has burned ${f.acres.toLocaleString("en-US")} acres${f.contained != null ? ` and is ${f.contained} percent contained` : ""}.` },
    ...later.map((text, i) => ({ at: 12.4 + i * 3.6, text })),
    { at: 12.4 + later.length * 3.6, text: "If you're nearby, follow evacuation orders from local officials." },
  ];
}

interface BreakingData {
  lines: { intro: string; situation: string | null; until: string | null; safety: string };
  timing: { situation: number; until: number; safety: number };
}

/** Breaking news (kinds/breaking.ts writes the lines from the alert's facts and times the scenes to them). */
function breaking(d: BreakingData): Cue[] {
  const { lines: l, timing: t } = d;
  return [
    { at: 0.4, text: l.intro },
    ...(l.situation ? [{ at: t.situation, text: l.situation }] : []),
    ...(l.until ? [{ at: t.until, text: l.until }] : []),
    { at: t.safety, text: l.safety },
  ];
}

const BY_TEMPLATE: Record<string, (d: never) => Cue[]> = {
  "breaking.html": breaking,
  "fire.html": fire,
  "outlook.html": outlook,
  "recap.html": recap,
  "weekly.html": weekly,
  "tropical.html": tropical,
};

/** The narration for a Short, ready to speak (empty when its page has none). */
export function narration(v: Pick<Video, "template" | "data">): Cue[] {
  const make = BY_TEMPLATE[v.template];
  return make ? make(v.data as never).map((c) => ({ at: c.at, text: spoken(c.text) })).filter((c) => c.text) : [];
}
