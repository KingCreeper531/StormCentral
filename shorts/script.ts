/**
 * A livelier narrator: a language model running in Ollama rewrites each line
 * of the plain script (narration.ts) the way an upbeat TV meteorologist would
 * say it. It only rephrases: every rewritten line is checked against its
 * scene's facts (numbers, places, days, risk levels, hazards, times of day,
 * directions, "no"/"not", hype words and length), and a line that fails keeps
 * its plain wording. When the model can't be reached, the plain script is
 * used as is. voice.ts also swaps a rewrite for the plain line when it runs
 * too long to fit the video.
 */
import { spoken, STATE_NAMES, type Cue } from "./narration";
import type { Video } from "./video";

export const DEFAULT_MODEL = "gemma3:12b";
export const DEFAULT_HOST = "http://127.0.0.1:11434";
/** How fast the narrator talks (edge-tts at its default rate), to size each line. */
const WORDS_PER_SECOND = 2.7;
/** Every Short ends with a few silent seconds on the end card. */
const END_CARD = 6.5;

const ABOUT: Record<string, string> = {
  "outlook.html": "today's severe weather outlook from NOAA's Storm Prediction Center, posted every morning",
  "recap.html": "today's storm reports from the National Weather Service, posted at night",
  "weekly.html": "the severe weather outlook for the next eight days, posted Sunday mornings",
  "tropical.html": "the latest National Hurricane Center advisory on a tropical storm or hurricane",
  "fire.html": "the latest on a large wildfire, from the National Interagency Fire Center",
  "snow.html": "the snowfall reports sent to the National Weather Service in the past 24 hours, posted the morning after a snowstorm (some are storm totals covering more than a day, so never say the snow all fell in 24 hours)",
  "seasonal.html": "NOAA's Climate Prediction Center outlook for the next three months: where a warmer, colder, wetter or drier than normal season is more likely (odds, not a forecast of amounts), updated once a month",
};

const SYSTEM = `You are the narrator of Storm Central, a weather channel on YouTube. You write the voice-over for its Shorts: short vertical videos drawn from NOAA data. Each Short already has a plain script, one line per scene, and the video shows each scene while its line is read.

Rewrite every line so it sounds like an energetic, likable TV meteorologist talking straight to the viewer: vivid verbs, natural rhythm, a little personality, and lines that flow into each other. Keep it warm and confident, never silly.

Rules:
- Exactly one line per scene, in the same order, each about its own scene.
- Open with a hook: the first line should grab the viewer with the most interesting fact in the video (the risk level, the storm's or fire's name, a big number), not a stock intro like "Let's dive in" or "Let's take a look".
- Use only the facts in the plain lines and the background. Never add numbers, places, days, times of day, directions, hazards, sizes, impacts or advice that aren't there, and never make a threat sound bigger or smaller than the facts say.
- Keep every number exactly as given, always in digits, never spelled out ("10 percent", "level 3 of 5").
- Don't describe the sky, temperature or how nice the weather is. In a week-ahead outlook, "quiet" only means no severe storms are expected.
- Stay within each line's word limit; shorter is fine. Short, punchy sentences beat long ones.
- No greetings tied to a time of day, no "folks", no emojis, hashtags or links, and don't ask viewers to like, follow or subscribe.
- At most two exclamation marks in the whole script. Don't start lines the same way.

Reply with JSON only: {"lines": ["...", "..."]}.`;

type Data = Record<string, unknown>;
const obj = (v: unknown): Data => (v && typeof v === "object" ? (v as Data) : {});

/** Extra facts a line may use besides its own: what the video shows but the plain script doesn't read out. */
export function background(v: Pick<Video, "template" | "data">): string[] {
  const d = obj(v.data);
  const out: (string | false | null | undefined)[] = [];
  if (v.template === "outlook.html") {
    const o = obj(d.outlook);
    if (typeof o.summary === "string") out.push(`The Storm Prediction Center's summary: ${o.summary}`);
  } else if (v.template === "tropical.html") {
    const s = obj(d.storm);
    const fc = Array.isArray(s.forecast) ? s.forecast.map(obj) : [];
    const last = fc.at(-1);
    if (typeof s.title === "string") out.push(`The storm: ${s.title}.`);
    if (typeof s.basin === "string") out.push(`Basin: ${s.basin}.`);
    if (typeof s.pressureMb === "number") out.push(`Central pressure: ${s.pressureMb} millibars.`);
    if (fc.length) out.push(`Forecast: ${fc.map((p) => `${p.when}, ${p.stage}${typeof p.windMph === "number" ? ` with ${p.windMph} mph winds` : ""}`).join("; ")}.`);
    if (typeof s.windMph === "number" && typeof last?.windMph === "number" && last.windMph !== s.windMph)
      out.push(last.windMph > s.windMph ? "It is forecast to strengthen." : "It is forecast to weaken.");
  } else if (v.template === "seasonal.html") {
    const s = obj(d.season);
    if (typeof d.issued === "string") out.push(`Issued ${d.issued} by NOAA's Climate Prediction Center.`);
    if (typeof s.range === "string") out.push(`It covers ${s.range}.`);
    for (const k of ["temp", "prcp"]) {
      const panel = obj(d[k]).panel;
      if (Array.isArray(panel)) out.push(...panel.filter((x): x is string => typeof x === "string").map((x) => `${k === "temp" ? "Temperature" : "Precipitation"}, ${x}.`));
    }
  } else if (v.template === "snow.html") {
    const top = Array.isArray(d.top) ? d.top.map(obj) : [];
    if (typeof d.date === "string") out.push(`Posted ${d.date}.`);
    if (top.length) out.push(`The biggest totals: ${top.map((r) => `${String(r.value).replace(/ in$/, " inches")} near ${r.place}`).join("; ")}.`);
    const c = obj(d.counts);
    if (typeof c.total === "number") out.push(`${c.total} places reported snow.`);
    if (typeof c.foot === "number" && c.foot) out.push(`${c.foot} places reported a foot or more.`);
  } else if (v.template === "fire.html") {
    const f = obj(d.fire);
    if (typeof f.name === "string") out.push(`The fire: the ${f.name}.`);
    if (typeof f.place === "string" && f.place) out.push(`Location: ${f.place}.`);
    if (typeof f.days === "number") out.push(`Burning for ${f.days} days.`);
  }
  return out.filter((x): x is string => !!x).map(spoken);
}

const wordCount = (s: string) => s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;

/** How many words each line may have: what fits until the next line (the last one until the end card), and never fewer than the plain line. */
export function wordBudgets(cues: Cue[], duration: number): number[] {
  return cues.map((c, i) => {
    const end = i + 1 < cues.length ? cues[i + 1]!.at : duration - END_CARD;
    return Math.max(4, Math.floor((end - c.at) * WORDS_PER_SECOND), wordCount(c.text));
  });
}

export function buildPrompt(v: Pick<Video, "template" | "data">, cues: Cue[], budgets: number[], bg = background(v)): string {
  return [
    `This Short: ${ABOUT[v.template] ?? "a weather update"}.`,
    bg.length ? `Background facts (use them only where they fit a scene):\n${bg.map((b) => `- ${b}`).join("\n")}` : "",
    `Scenes, in order, each with its plain line and word limit:\n${cues.map((c, i) => `${i + 1}. [at most ${budgets[i]} words] ${c.text}`).join("\n")}`,
    `Write exactly ${cues.length} lines.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ── Checking a rewritten line ───────────────────────────────────────────────

const UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const COMPOUND = new RegExp(`\\b(${TENS.slice(2).join("|")})[- ](${UNITS.slice(1, 10).join("|")})\\b`, "gi");
const SINGLE = new RegExp(`\\b(${["zero", ...UNITS.slice(2), ...TENS.slice(2)].join("|")})\\b`, "gi");

/**
 * Numbers the model spelled out, in digits ("five percent" → "5 percent",
 * "Thirty-one" → "31"), so they're checked like the rest; the narrator reads
 * them the same. "One" stays a word ("this one", "one of the"), and so does
 * a number word the facts use themselves (the Three Queens Fire).
 */
export function digits(line: string, facts = ""): string {
  const value = (w: string) => (UNITS.includes(w.toLowerCase()) ? UNITS.indexOf(w.toLowerCase()) : TENS.indexOf(w.toLowerCase()) * 10);
  const keep = (w: string) => hasWord(facts, w);
  return line
    .replace(COMPOUND, (m: string, t: string, u: string) => (keep(m) ? m : String(value(t) + value(u))))
    .replace(SINGLE, (w: string) => (keep(w) ? w : String(value(w))));
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasWord = (text: string, word: string) => new RegExp(`(^|[^a-z0-9])${esc(word.toLowerCase())}($|[^a-z0-9])`).test(text.toLowerCase());
const numbersIn = (s: string) => (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, "").replace(/\.$/, ""));

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const REGIONS = [
  "Plains", "Midwest", "Great Lakes", "Gulf Coast", "Gulf", "Mid-Atlantic", "New England", "Ohio Valley", "Tennessee Valley", "Mississippi Valley",
  "Mid-South", "Deep South", "Southeast", "Northeast", "Southwest", "Northwest", "Rockies", "Dakotas", "Panhandle", "Ozarks", "Appalachians",
  "Atlantic", "Pacific", "Caribbean", "Mexico", "Canada", "Florida Keys",
];
/** Places, days and months: wherever they appear, they must be in the facts. */
const NAMES = [...new Set([...Object.values(STATE_NAMES), ...DAY_NAMES, ...MONTHS, ...REGIONS])].sort((a, b) => b.length - a.length);
/** Capitalized words a line may always use. */
const ALWAYS = new Set(["i", "i'm", "i'll", "i've", "i'd", "storm", "central", "noaa", "nws", "spc", "nhc", "national", "weather", "service", "prediction", "center", "hurricane", "interagency", "fire", "u.s", "us", "am", "pm"]);
const SPELLED = /\b(hundreds?|thousands?|millions?|dozens?|half|twice|double|triple|single)\b/gi;
const RISK = /\b(marginal|slight|enhanced|moderate|high)\s+risk\b/gi;
/** SPC's category words: "slight chance" for a Marginal Risk would name the wrong level. */
const CATEGORY = /\b(marginal\w*|slight\w*|enhanced|moderate\w*)\b/gi;
/** Talk of a storm's motion, which needs the facts to give it. */
const MOTION = /\b(mov(e|es|ing|ement)|drift\w*|crawl\w*|stall\w*|stationary|wiggl\w*|travel\w*|heading)\b/i;
const DAY_PARTS = /\b(morning|afternoon|evening|tonight|overnight|night|midday|noon|midnight|weekend|tomorrow|yesterday)\b/gi;

/** The parts of the day the facts' clock times fall in ("5 PM" → evening), which a line may name instead. */
function dayPartsOf(facts: string): Set<string> {
  const parts = new Set<string>();
  for (const m of facts.matchAll(/\b(\d{1,2})(?::\d\d)?\s*([AP])\.?M\b/gi)) {
    const h = (Number(m[1]) % 12) + (m[2]!.toUpperCase() === "P" ? 12 : 0);
    parts.add(h < 5 ? "overnight" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "night");
  }
  return parts;
}
const DIRECTIONS = /\b(?:north|south|east|west)(?:east|west)?(?:ern|ward|wards|erly)?\b/gi;
const HAZARDS: [string, RegExp][] = [
  ["tornadoes", /\btornad/i],
  ["hail", /\bhail/i],
  ["wind", /\b(wind|gust)/i],
  ["flooding", /\bflood/i],
  ["rain", /\b(rain|downpour)/i],
  ["lightning", /\blightning/i],
  ["snow", /\b(snow|blizzard)/i],
  ["ice", /\b(ice|icy|sleet|freezing)\b/i],
  ["storm surge", /\bsurge/i],
  ["heat", /\bheat\b/i],
  ["smoke", /\bsmoke/i],
];
/** Claims, sizes and alarm words that only the facts may bring up. */
const LOADED =
  /\b(catastroph\w*|devastat\w*|deadly|life-threatening|historic|record\w*|confirm\w*|EF-?\d|outbreak|derecho|emergency|particularly dangerous|PDS|monster|massive|violent|significant|destructive|evacuat\w*|shelter|take cover|huge|giant|intense|intensif\w*|strengthen\w*|weaken\w*|rapid\w*|explosive|strong tornad\w*|breaking|behemoth|enormous|inferno|stall\w*|stationary|drift\w*|crawl\w*|barely moving|hardly moving|isn['’]t moving|not moving|golf[- ]?balls?|baseballs?|softballs?|tennis[- ]balls?|grapefruits?|ping[- ]pong|half[- ]dollars?|quarters?|eggs?|walnuts?|marbles?|peas?|pennies|penny|nickels?|dimes?)\b/gi;
const NOT = /\b(no|not|none|never|nothing|quiet|calm|peaceful|tranquil|unlikely|without)\b|n['’]t\b/i;
const NOT_CLAIM = /\b(no|zero)\s+(severe|storms?|tornado(?:es)?|hail|wind)\b|\bnot\s+expected\b|n['’]t\s+expected\b|\b(unlikely|quiet|calm|peaceful|tranquil)\b/i;
/** Weather the Shorts never report (sky, temperature, "nice"): the model mustn't paint it in. */
const WEATHER =
  /\b(clear|sunny|sunshine|lovel\w*|beautiful\w*|gorgeous|pleasant\w*|nice\w*|dry|warm\w*|hot|cold\w*|chilly|cool\w*|cloud\w*|fog\w*|humid\w*|muggy|breezy)\b/gi;
const OFF_LIMITS = /https?:|www\.|#\w|\bsubscribe\b|\blike button\b|\bcomments? below\b|\bfolks\b|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/iu;

/** Capitalized words that don't start a sentence (names the model may have made up). */
function midSentenceNames(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/[A-Za-z][\w'’.-]*/g)) {
    const word = m[0].replace(/['’]s$/, "").replace(/[.'’-]+$/, "");
    if (!/^[A-Z]/.test(word)) continue;
    const before = s.slice(0, m.index).trimEnd();
    if (!before || /[.!?:;—–"“(]$/.test(before)) continue;
    out.push(word);
  }
  return out;
}

const root = (dir: string) => dir.toLowerCase().replace(/(ern|wards?|erly)$/, "");

export interface LineFacts {
  /** The plain line this one rewrites. */
  scene: string;
  /** The first line, which may tease any fact in the video. */
  hook?: boolean;
  /** Everything the line may draw on: the scene, plus the background facts. */
  allowed: string;
  /** The line's word limit. */
  words: number;
}

/** Why a rewritten line can't be used, or null when it passes. `line` is as it will be read (spoken()). */
export function checkLine(line: string, f: LineFacts): string | null {
  const words = wordCount(line);
  if (words < 2) return "empty";
  if (words > Math.ceil(f.words * 1.15) + 1) return `too long (${words} words, limit ${f.words})`;
  if (OFF_LIMITS.test(line)) return "off-limits words";

  const facts = f.allowed;
  const factNumbers = new Set(numbersIn(facts));
  const number = numbersIn(line).find((n) => !factNumbers.has(n));
  if (number) return `number ${number} isn't in the facts`;
  for (const m of line.matchAll(SPELLED)) if (!hasWord(facts, m[0])) return `"${m[0]}" isn't in the facts`;

  let rest = line;
  for (const name of NAMES) {
    const re = new RegExp(`\\b${esc(name)}\\b`, "g");
    if (!re.test(rest)) continue;
    if (!hasWord(facts, name)) return `"${name}" isn't in the facts`;
    rest = rest.replace(re, " ");
  }
  const name = midSentenceNames(rest).find((w) => !ALWAYS.has(w.toLowerCase()) && !hasWord(facts, w));
  if (name) return `"${name}" isn't in the facts`;

  for (const m of line.matchAll(RISK)) if (!hasWord(facts, m[0])) return `"${m[0]}" isn't in the facts`;
  for (const m of line.matchAll(CATEGORY)) if (!new RegExp(`\\b${esc(m[0])}`, "i").test(facts)) return `"${m[0]}" isn't in the facts`;
  if (MOTION.test(line) && !MOTION.test(facts)) return "says how it's moving; the facts don't";
  const dayParts = dayPartsOf(facts);
  for (const m of line.matchAll(DAY_PARTS)) if (!hasWord(facts, m[0]) && !dayParts.has(m[0].toLowerCase())) return `"${m[0]}" isn't in the facts`;
  const directions = new Set([...facts.matchAll(DIRECTIONS)].map((m) => root(m[0])));
  for (const m of line.matchAll(DIRECTIONS)) if (!directions.has(root(m[0]))) return `"${m[0]}" isn't in the facts`;
  for (const [hazard, re] of HAZARDS) if (re.test(line) && !re.test(facts)) return `${hazard} aren't in the facts`;
  // By stem, so "weakening" matches the facts' "forecast to weaken".
  for (const m of line.matchAll(LOADED)) if (!new RegExp(`\\b${esc(m[0].replace(/(ing|ed|es|s)$/i, ""))}`, "i").test(facts)) return `"${m[0]}" isn't in the facts`;

  for (const m of line.matchAll(WEATHER)) if (!hasWord(facts, m[0])) return `"${m[0]}" isn't in the facts`;

  if (NOT.test(f.scene) && !NOT.test(line)) return "drops the scene's no/not";
  if (NOT_CLAIM.test(line) && !NOT.test(f.hook ? facts : f.scene)) return "says no/not where the scene doesn't";
  return null;
}

// ── Asking the model ────────────────────────────────────────────────────────

export interface WriterOptions {
  /** Claude instead of Ollama (ANTHROPIC_API_KEY): faster and better than a model on the runner's CPU. */
  anthropicKey?: string;
  /** The Claude model (SHORTS_CLAUDE_MODEL), default claude-haiku-5-5. */
  claudeModel?: string;
  /** Ollama's address (OLLAMA_HOST), default http://127.0.0.1:11434. */
  host?: string;
  model?: string;
  /** For tests. */
  fetch?: typeof fetch;
  /** Per request; a 12B model on a 4-core runner takes a few minutes. */
  timeoutMs?: number;
  log?: (line: string) => void;
}

const hostUrl = (host?: string) => {
  const h = (host || DEFAULT_HOST).trim().replace(/\/+$/, "");
  return /^https?:\/\//.test(h) ? h : `http://${h}`;
};

/** The lines in the model's reply. */
export function parseLines(reply: string, n: number): string[] {
  const text = reply.replace(/<think>[\s\S]*?<\/think>/g, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON in the reply");
  const lines = (JSON.parse(text.slice(start, end + 1)) as { lines?: unknown }).lines;
  if (!Array.isArray(lines) || !lines.every((l) => typeof l === "string")) throw new Error("no lines in the reply");
  if (lines.length !== n) throw new Error(`${lines.length} lines instead of ${n}`);
  return lines.map((l) => l.replace(/\s+/g, " ").trim());
}

export const DEFAULT_CLAUDE_MODEL = "claude-haiku-5-5";
/** Which model writes the drafts, for the log. */
export const writerName = (o: WriterOptions) => (o.anthropicKey ? o.claudeModel || DEFAULT_CLAUDE_MODEL : o.model || DEFAULT_MODEL);

/** One draft from Claude's Messages API, as JSON in the shape the prompt asks for. */
async function claudeDraft(prompt: string, n: number, o: WriterOptions): Promise<string[]> {
  const res = await (o.fetch ?? fetch)("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": o.anthropicKey!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: o.claudeModel || DEFAULT_CLAUDE_MODEL,
      max_tokens: 80 * n + 256,
      // A few lines of voice-over don't need reasoning (and Haiku's would count against max_tokens), as on the live stream.
      thinking: { type: "disabled" },
      output_config: {
        format: { type: "json_schema", schema: { type: "object", properties: { lines: { type: "array", items: { type: "string" } } }, required: ["lines"], additionalProperties: false } },
      },
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(o.timeoutMs ?? 60_000),
  });
  if (!res.ok) throw new Error(`Claude answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const r = (await res.json()) as { content?: { type: string; text?: string }[]; stop_reason?: string };
  // A cut-off reply isn't a whole script.
  if (r.stop_reason !== "end_turn") throw new Error(`Claude stopped: ${r.stop_reason}`);
  return parseLines((r.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join(""), n);
}

/** One draft of the script from Ollama's chat API (streamed, so a slow model can't hit an HTTP timeout). */
async function draft(prompt: string, n: number, o: WriterOptions): Promise<string[]> {
  if (o.anthropicKey) return claudeDraft(prompt, n, o);
  const model = o.model || DEFAULT_MODEL;
  // Thinking models write faster with thinking off; the rest don't take the setting.
  const think = /^(qwen3|gemma4|deepseek-r1|magistral)/.test(model) ? { think: false } : {};
  const res = await (o.fetch ?? fetch)(`${hostUrl(o.host)}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: true,
      keep_alive: "15m",
      ...think,
      format: { type: "object", properties: { lines: { type: "array", items: { type: "string" }, minItems: n, maxItems: n } }, required: ["lines"] },
      options: { temperature: 0.8, top_p: 0.9, num_ctx: 4096, num_predict: 80 * n + 64 },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(o.timeoutMs ?? 10 * 60_000),
  });
  if (!res.ok || !res.body) throw new Error(`Ollama answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  let reply = "";
  let buf = "";
  const decoder = new TextDecoder();
  const take = (row: string) => {
    if (!row.trim()) return;
    const msg = JSON.parse(row) as { message?: { content?: string }; error?: string };
    if (msg.error) throw new Error(`Ollama: ${msg.error}`);
    reply += msg.message?.content ?? "";
  };
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
      take(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  }
  take(buf + decoder.decode());
  return parseLines(reply, n);
}

/**
 * The livelier script for `v`: its plain cues, each line rewritten by the
 * model where the rewrite passes the checks (with `plain` kept, for voice.ts).
 * Asks twice when the first draft has more than one bad line, and takes each
 * line from the better draft first.
 */
export async function livelyNarration(v: Pick<Video, "template" | "data">, plain: Cue[], duration: number, o: WriterOptions = {}): Promise<Cue[]> {
  if (!plain.length) return plain;
  const log = o.log ?? console.log;
  const budgets = wordBudgets(plain, duration);
  const bg = background(v);
  const prompt = buildPrompt(v, plain, budgets, bg);
  const all = plain.map((c) => c.text).join(" ");
  const facts = (i: number): LineFacts => ({
    scene: plain[i]!.text,
    hook: i === 0,
    allowed: [i === 0 ? all : plain[i]!.text, ...bg].join(" "),
    words: budgets[i]!,
  });

  const drafts: (string | null)[][] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    let lines: string[];
    try {
      lines = await draft(prompt, plain.length, o);
    } catch (err) {
      const why = `${err instanceof Error ? err.message : err}${err instanceof Error && err.cause ? ` (${err.cause})` : ""}`;
      log(`AI draft ${attempt} failed: ${why}`);
      // No point asking again when Ollama isn't running or doesn't have the model, or Claude turns the key away.
      if (/ECONNREFUSED|fetch failed|not found|answered 40[13]/i.test(why)) break;
      continue;
    }
    log(`AI draft ${attempt} (${writerName(o)}, ${Math.round((Date.now() - started) / 1000)} s):`);
    const checked = lines.map((line, i) => {
      const said = spoken(digits(line, facts(i).allowed));
      const why = checkLine(said, facts(i));
      log(`  ${why ? "✗" : "✓"} ${said}${why ? `  (${why})` : ""}`);
      return why ? null : said;
    });
    drafts.push(checked);
    if (checked.filter((l) => l == null).length <= 1) break;
  }
  drafts.sort((a, b) => b.filter(Boolean).length - a.filter(Boolean).length);
  const cues = plain.map((c, i): Cue => {
    const line = drafts.map((d) => d[i]).find((l): l is string => !!l);
    return line && line !== c.text ? { at: c.at, text: line, plain: c.text } : c;
  });
  log(`AI narration: ${cues.filter((c) => c.plain).length} of ${cues.length} lines rewritten.`);
  return cues;
}
