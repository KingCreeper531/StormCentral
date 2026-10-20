/**
 * Drafts a Radar School lesson on a topic with the local model (Ollama),
 * from sources it's given (research.ts: Wikipedia and NOAA/NWS pages), and
 * checks it: every factual line must come with a quote that really appears
 * in a source and carries the line's numbers (checkEvidence). A line that
 * fails is rewritten from its quotes once, then dropped. Then a second,
 * different model (REVIEW_MODEL) reads every kept line against its sources
 * and must call it supported, or the line goes too.
 *
 * With --auto the draft approves itself when it passes every gate (gates()):
 * enough backed lines, few dropped, full length, and safety advice only from
 * NOAA/NWS pages. Otherwise it's saved unapproved for a person. Only approved
 * lessons are ever made into videos (kinds/lesson.ts), each in its own week.
 *
 * Run by the "Draft a Radar School lesson" workflow:
 *   npx tsx shorts/lesson-draft.ts --topic "radar velocity" --id velocity [--urls a,b] [--auto]
 *   npx tsx shorts/lesson-draft.ts --next --auto     (the next topic in shorts/lessons/topics.txt)
 * Environment: OLLAMA_HOST, SHORTS_AI_MODEL (writer, default gemma3:12b), REVIEW_MODEL (reviewer, default qwen3:8b).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CASES, nextFreeWeek, timeline, validLesson, type Lesson } from "./kinds/lesson";
import { checkEvidence, JETSTREAM_RADAR, pages, relevant, wikipedia, type Evidence, type Source } from "./research";

const env = process.env;
const MODEL = env.SHORTS_AI_MODEL || "gemma3:12b";
/** A different model family from the writer, so it doesn't share the writer's blind spots. */
const REVIEWER = env.REVIEW_MODEL || "qwen3:8b";
const HOST = (env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/^(?!https?:\/\/)/, "http://");

async function ask<T>(system: string, prompt: string, schema: object, { maxTokens = 1500, temperature = 0.4, model = MODEL } = {}): Promise<T> {
  const res = await fetch(`${HOST}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      // One model in memory at a time on the runner.
      keep_alive: "5m",
      ...(/^(qwen3|deepseek-r1|gemma4|magistral)/.test(model) ? { think: false } : {}),
      format: schema,
      options: { temperature, num_ctx: 8192, num_predict: maxTokens },
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(20 * 60_000),
  });
  if (!res.ok) throw new Error(`Ollama answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { message?: { content?: string } };
  return JSON.parse(body.message?.content ?? "{}") as T;
}

const SYSTEM = `You write scripts for Radar School, a YouTube series that teaches ordinary people how to read weather radar. The narrator reads your lines over radar pictures and diagrams.

Rules:
- Use ONLY facts stated in the SOURCES you're given. If the sources don't say it, don't write it. Never invent numbers, dates, names or examples.
- Every factual line needs "quotes": one or two sentences copied word for word from the SOURCES that back it up.
- Plain, friendly, accurate English for beginners. Short sentences. Explain any term the first time it's used.
- Rules of thumb are rules of thumb: say "usually", "often" or "about" where the sources do.
- Reply with JSON only, in the shape asked for.`;

const VISUALS = `Pick each line's "visual" from this menu (JSON):
- {"type":"bullets","heading":"…","items":["…","…"]}  a text card (agendas, lists, recaps)
- {"type":"radar","storm":{"kind":"supercell","product":"ref"|"vel"|"cc","notes":[{"target":"core"|"hook"|"meso"|"notch"|"couplet"|"debris","text":"short label"}]}}  a simulated rotating storm
- {"type":"radar","storm":{"kind":"multicell","product":"ref","notes":[{"target":"core"|"light"|"edge","text":"…"}]}}  simulated ordinary storms
- {"type":"radar","storm":{"kind":"bow","notes":[{"target":"apex"|"notch","text":"…"}]}}  a simulated bow echo
- {"type":"radar","storm":{"kind":"hail","notes":[{"target":"core"|"spike","text":"…"}]}}  a simulated hail core with a three-body scatter spike
- {"type":"radar","storm":{"kind":"case","case":"${Object.keys(CASES).join('"|"')}","product":"ref"|"vel"|"cc","notes":[{"target":"core"|"couplet"|"debris","text":"…"}]}}  real radar of a famous storm (only if the line is about that kind of storm)
- {"type":"works","phase":0|1|2|3}  how radar works: the dish, a pulse going out, scattering off rain, the echo coming back
- {"type":"drops"}  small vs big raindrops and echo strength
- {"type":"sweep","storm":{"kind":"multicell"}}  the dish turning, painting the storm
- {"type":"tilts"}  the stack of scan angles
- {"type":"beam","marks":[60,120]}  the beam's height with distance`;

const beatSchema = {
  type: "object",
  properties: {
    say: { type: "string" },
    caption: { type: "string" },
    bullet: { type: "string" },
    claim: { type: "boolean" },
    quotes: { type: "array", items: { type: "string" } },
    visual: { type: "object" },
  },
  required: ["say", "caption", "claim", "quotes", "visual"],
};

interface DraftBeat {
  say: string;
  caption: string;
  bullet?: string;
  claim: boolean;
  quotes: string[];
  visual: Record<string, unknown>;
}

function sourcesBlock(ps: { source: Source; text: string }[]) {
  return ps.map((p, i) => `[${i + 1}] (${p.source.title})\n${p.text}`).join("\n\n");
}

export interface Checked {
  beat: DraftBeat;
  evidence: Evidence | null;
  dropped?: string;
  /** The second model's verdict. */
  review?: string;
}

const REVIEW_SYSTEM = `You are a strict fact-checker for an educational weather channel. You get one line of a script and the source text it's based on. Decide whether the source fully supports the line.

- "supported": every claim in the line, including words like always, usually, most, only, and every number, is stated or directly implied by the source.
- "partly": some of it is supported, but something is added, overstated, too certain, or changed.
- "unsupported": the source doesn't back it, or contradicts it.
Be strict: when unsure, it isn't "supported". Reply with JSON only.`;

/** Lines about staying safe: those may only come from NOAA/NWS pages. */
export const SAFETY = /\b(shelter|safe(ty)?|evacuat\w*|drive|driving|outrun|overpass|basement|interior room|bathtub|window|lightning strike|warning|take cover)\b/i;

export interface Gate {
  name: string;
  ok: boolean;
  detail: string;
}

/** Whether a draft may approve itself with no person reading it. */
export function gates(checked: Checked[], lesson: Lesson): Gate[] {
  const claims = checked.filter((x) => x.evidence);
  const kept = claims.filter((x) => !x.dropped);
  const droppedShare = claims.length ? (claims.length - kept.length) / claims.length : 1;
  const unsafe = kept.filter((x) => SAFETY.test(x.beat.say) && !(x.evidence?.quotes ?? []).some((q) => q.source.kind === "noaa"));
  const minutes = timeline(lesson).end / 60;
  return [
    { name: "Enough backed lines", ok: kept.length >= 14, detail: `${kept.length} factual lines kept (need 14)` },
    { name: "Few lines dropped", ok: droppedShare <= 0.3, detail: `${Math.round(droppedShare * 100)}% of factual lines dropped (at most 30%)` },
    { name: "Every kept line backed and reviewed", ok: kept.every((x) => x.evidence?.verdict === "supported" && x.review === "supported"), detail: "quote found word for word and the second model agreed" },
    { name: "Safety advice only from NOAA/NWS", ok: unsafe.length === 0, detail: unsafe.length ? unsafe.map((x) => `"${x.beat.say}"`).join("; ") : "none from other sources" },
    { name: "Full length", ok: minutes >= 4, detail: `${minutes.toFixed(1)} minutes (need 4)` },
    { name: "Enough chapters", ok: lesson.chapters.length >= 5, detail: `${lesson.chapters.length} chapters including introduction and recap (need 5)` },
  ];
}

/** The next topic in the queue (shorts/lessons/topics.txt: "id | topic | optional extra URLs") with no lesson yet. */
export function nextTopic(file = "shorts/lessons/topics.txt", dir = "shorts/lessons"): { id: string; topic: string; urls: string[] } | null {
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const [id, topic, urls] = line.split("|").map((s) => s?.trim() ?? "");
    if (!id || !topic || line.trim().startsWith("#")) continue;
    if (!existsSync(join(dir, `${id}.json`))) return { id, topic, urls: (urls ?? "").split(",").map((u) => u.trim()).filter(Boolean) };
  }
  return null;
}

async function main() {
  const arg = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const auto = process.argv.includes("--auto");
  const queued = process.argv.includes("--next") ? nextTopic() : null;
  if (process.argv.includes("--next") && !queued) return console.log("Every topic in shorts/lessons/topics.txt has a lesson; add more topics.");
  const topic = queued?.topic ?? arg("topic");
  const id = (queued?.id ?? arg("id") ?? topic ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!topic || !id) throw new Error('Usage: lesson-draft.ts --topic "radar velocity" --id velocity [--urls a,b] [--auto], or --next [--auto]');
  const extra = [...(queued?.urls ?? []), ...(arg("urls") || "").split(",").map((s) => s.trim()).filter(Boolean)];

  console.log(`Gathering sources for "${topic}"…`);
  const sources = [...(await pages([...JETSTREAM_RADAR, ...extra])), ...(await wikipedia(topic)), ...(await wikipedia(`${topic} weather radar`, { limit: 2 }))];
  const unique = sources.filter((s, i) => sources.findIndex((t) => t.url === s.url) === i);
  for (const s of unique) console.log(`  ${s.kind === "noaa" ? "NOAA" : "Wiki"}  ${s.title} (${s.text.length} chars)  ${s.url}`);
  if (!unique.length) throw new Error("No sources could be loaded");

  // 1. The outline, from the most relevant passages.
  const top = relevant(unique, topic, 7_000);
  const outline = await ask<{ title: string; youtube: string; summary: string; chapters: { title: string; points: string[] }[] }>(
    SYSTEM,
    `Plan a Radar School lesson of about 6 minutes on: ${topic}.\n\nSOURCES:\n${sourcesBlock(top)}\n\nReply as {"title": short lesson title, "youtube": a YouTube title under 90 characters ending in "| Radar School", "summary": two sentences on what the lesson covers, "chapters": [{"title", "points": [3-6 things to teach, each backed by the sources]}]} with 4 to 5 teaching chapters (no introduction or recap; those are added).`,
    { type: "object", properties: { title: { type: "string" }, youtube: { type: "string" }, summary: { type: "string" }, chapters: { type: "array", items: { type: "object", properties: { title: { type: "string" }, points: { type: "array", items: { type: "string" } } }, required: ["title", "points"] } } }, required: ["title", "youtube", "summary", "chapters"] },
  );
  console.log(`Outline: ${outline.title}\n${outline.chapters.map((c) => `  - ${c.title}: ${c.points.join("; ")}`).join("\n")}`);

  // 2. Each chapter's lines, then the check.
  const chapters: { title: string; checked: Checked[] }[] = [];
  for (const ch of outline.chapters.slice(0, 5)) {
    const ps = relevant(unique, `${ch.title} ${ch.points.join(" ")}`, 6_000);
    const reply = await ask<{ beats: DraftBeat[] }>(
      SYSTEM,
      `Lesson: ${outline.title}. Chapter: ${ch.title}. Teach these points, in order: ${ch.points.join("; ")}.\n\nSOURCES:\n${sourcesBlock(ps)}\n\n${VISUALS}\n\nWrite 4 to 7 lines. Each line: "say" (what the narrator says, at most 35 words), "caption" (the on-screen headline, at most 60 characters), "bullet" (optional key point to keep on screen, at most 40 characters), "claim" (true if the line states a fact), "quotes" (for a claim: 1-2 sentences copied exactly from the SOURCES that back it), "visual" (from the menu). Reply as {"beats": [...]}.`,
      { type: "object", properties: { beats: { type: "array", items: beatSchema } }, required: ["beats"] },
      { maxTokens: 2500 },
    );
    const checked: Checked[] = [];
    for (let beat of reply.beats ?? []) {
      // A line with a number always counts as a claim, whatever the model says.
      const needsEvidence = beat.claim || /\d/.test(beat.say);
      if (!needsEvidence) {
        checked.push({ beat, evidence: null });
        continue;
      }
      let ev = checkEvidence(beat.say, beat.quotes ?? [], unique);
      if (ev.verdict !== "supported") {
        // One more try: rewrite the line from passages, quoting them.
        const retry = await ask<DraftBeat>(
          SYSTEM,
          `This line wasn't backed by the sources (${ev.why}):\n"${beat.say}"\n\nSOURCES:\n${sourcesBlock(ps)}\n\nRewrite it so it says only what the SOURCES say, and give the exact sentences that back it. Keep the same visual and caption if they still fit. Reply as one line object: {"say","caption","bullet","claim":true,"quotes":[...],"visual"}.`,
          beatSchema,
          { maxTokens: 600, temperature: 0.2 },
        ).catch(() => null);
        if (retry?.say) {
          const ev2 = checkEvidence(retry.say, retry.quotes ?? [], unique);
          if (ev2.verdict === "supported") [beat, ev] = [{ ...beat, ...retry, visual: retry.visual ?? beat.visual }, ev2];
        }
      }
      checked.push(ev.verdict === "supported" ? { beat, evidence: ev } : { beat, evidence: ev, dropped: ev.why });
      console.log(`  ${ev.verdict === "supported" ? "✓" : "✗"} ${beat.say}${ev.verdict === "supported" ? "" : `  (${ev.why})`}`);
    }
    chapters.push({ title: ch.title, checked });
  }

  // 3. The second model reviews every kept factual line against its sources; anything it doesn't call supported goes.
  console.log(`\nSecond review by ${REVIEWER}…`);
  // Free the writer's memory first: the runner fits one model at a time.
  await fetch(`${HOST}/api/generate`, { method: "POST", body: JSON.stringify({ model: MODEL, keep_alive: 0 }) }).catch(() => {});
  for (const c of chapters)
    for (const x of c.checked) {
      if (x.dropped) continue;
      if (!x.evidence) {
        // A line marked as no claim must really state no fact.
        const r = await ask<{ states_a_fact: boolean }>(REVIEW_SYSTEM, `Does this script line state any fact about weather, radar or safety (not just a transition, agenda or invitation)?\nLINE: "${x.beat.say}"\nReply {"states_a_fact": true|false}.`, { type: "object", properties: { states_a_fact: { type: "boolean" } }, required: ["states_a_fact"] }, { model: REVIEWER, maxTokens: 30, temperature: 0 }).catch(() => ({ states_a_fact: true }));
        if (r.states_a_fact) [x.dropped, x.review] = ["it states a fact without a source", "unsupported"];
        else x.review = "no claim";
        continue;
      }
      const context = relevant(unique, x.beat.say, 2_500).map((p) => `(${p.source.title}) ${p.text}`).join("\n\n");
      const r = await ask<{ verdict: string; problem: string }>(
        REVIEW_SYSTEM,
        `LINE: "${x.beat.say}"\n\nQUOTES THE WRITER GAVE:\n${x.evidence.quotes.map((q) => `- "${q.text}" (${q.source.title})`).join("\n")}\n\nMORE SOURCE TEXT:\n${context}\n\nReply {"verdict": "supported"|"partly"|"unsupported", "problem": "what isn't supported, or empty"}.`,
        { type: "object", properties: { verdict: { type: "string", enum: ["supported", "partly", "unsupported"] }, problem: { type: "string" } }, required: ["verdict", "problem"] },
        { model: REVIEWER, maxTokens: 120, temperature: 0 },
      ).catch((err: unknown) => ({ verdict: "unsupported", problem: `reviewer failed: ${err instanceof Error ? err.message : err}` }));
      x.review = r.verdict;
      if (r.verdict !== "supported") x.dropped = `second review: ${r.verdict}${r.problem ? ` (${r.problem})` : ""}`;
      console.log(`  ${r.verdict === "supported" ? "✓" : "✗"} ${x.beat.say}${r.verdict === "supported" ? "" : `  (${r.verdict}: ${r.problem})`}`);
    }

  // 4. The lesson: an introduction and a recap around the checked lines.
  const kept = chapters.map((c) => ({ title: c.title, beats: c.checked.filter((x) => !x.dropped).map((x) => x.beat) })).filter((c) => c.beats.length >= 2);
  const firstRadar = kept.flatMap((c) => c.beats).find((b) => b.visual.type === "radar")?.visual.storm as Record<string, unknown> | undefined;
  const lessonRaw = {
    id,
    title: outline.title,
    youtube: outline.youtube.length <= 100 ? outline.youtube : `${outline.title} | Radar School`,
    summary: outline.summary,
    es: { title: `${outline.title} | Escuela de Radar`, summary: outline.summary },
    thumb: { lines: outline.title.toUpperCase().split(/\s+/).reduce<string[]>((ls, w) => (ls.length && (ls.at(-1)! + " " + w).length <= 12 ? [...ls.slice(0, -1), `${ls.at(-1)} ${w}`] : [...ls, w]), []).slice(0, 3), visual: { storm: firstRadar ?? { kind: "supercell", p: { hook: 1, notch: 1 } } } },
    tags: ["weather radar", "how to read radar", topic, "meteorology", "severe weather", "Radar School", "Storm Central"],
    chapters: [
      {
        title: "Introduction",
        beats: [
          { visual: { type: "title" }, say: `${outline.summary}`, min: 7 },
          { visual: { type: "bullets", heading: "In this lesson", items: kept.map((c) => c.title) }, caption: "What we'll cover", say: `We'll cover ${kept.map((c) => c.title.toLowerCase()).join(", ")}.`, min: 8 },
        ],
      },
      ...kept.map((c) => ({ title: c.title, beats: c.beats.map((b) => ({ say: b.say, caption: b.caption, bullet: b.bullet || undefined, visual: b.visual })) })),
      {
        title: "Recap",
        beats: [
          {
            visual: { type: "bullets", heading: "Recap", items: kept.flatMap((c) => c.beats.map((b) => b.bullet).filter(Boolean)).slice(0, 6) },
            caption: "What to remember",
            say: `That's the lesson: ${kept.map((c) => c.title.toLowerCase()).join(", ")}. Subscribe for a new Radar School lesson every week.`,
            min: 12,
          },
        ],
      },
    ],
    approved: false,
    checked: "auto",
    sources: unique.map((s) => ({ title: s.title, url: s.url })),
  };
  let lesson: Lesson = validLesson(lessonRaw);
  const all = chapters.flatMap((c) => c.checked.map((x) => ({ ...x, chapter: c.title })));
  const results = gates(all, lesson);
  const passed = results.every((g) => g.ok);
  if (auto && passed) lesson = { ...lesson, approved: true, week: nextFreeWeek(Date.now()) };

  // 5. The review report.
  const supported = all.filter((x) => x.evidence && !x.dropped).length;
  const noClaim = all.filter((x) => !x.evidence).length;
  const dropped = all.filter((x) => x.dropped);
  const report = [
    `# Review: ${lesson.title}`,
    "",
    `Drafted by ${MODEL}, reviewed by ${REVIEWER}, from the sources below.`,
    "",
    lesson.approved
      ? `**Approved automatically** (every gate passed): it posts in series week ${lesson.week}.`
      : `**Not approved**${auto ? " (a gate failed)" : ""}: read every line, then set \`"approved": true\` and a \`"week"\` in \`shorts/lessons/${id}.json\` to schedule it.`,
    "",
    "## Gates",
    ...results.map((g) => `- ${g.ok ? "✅" : "❌"} ${g.name}: ${g.detail}`),
    "",
    `- ${supported} factual lines kept: quote found word for word, and the second model agreed`,
    `- ${noClaim} lines with no factual claim (transitions, agendas)`,
    `- ${dropped.length} lines dropped because no source backed them`,
    "",
    "## What to check",
    "- Each quote really says what the line says (the check proves the quote exists, not that the line reads it right).",
    "- Rules of thumb are worded as such, nothing is overstated, and the visual fits the line.",
    "- Anything from Wikipedia alone that matters: confirm it on a NOAA/NWS page.",
    "",
    "## Sources",
    ...unique.map((s) => `- [${s.title}](${s.url})${s.kind === "noaa" ? " (NOAA/NWS)" : ""}`),
    "",
    "## Lines",
    ...all.map((x) => {
      const head = `- ${x.dropped ? "❌ **Dropped**" : x.evidence ? "✅" : "➖ no claim"} (${x.chapter}) ${x.beat.say}${x.review && x.evidence ? `  _(review: ${x.review})_` : ""}`;
      const q = (x.evidence?.quotes ?? []).map((q) => `  > ${q.text}\n  > — [${q.source.title}](${q.source.url})${q.source.kind === "wikipedia" ? " ⚠️ Wikipedia only" : ""}`);
      return [head, ...(x.dropped ? [`  Why: ${x.dropped}`] : []), ...q].join("\n");
    }),
  ].join("\n");

  mkdirSync("shorts/lessons", { recursive: true });
  writeFileSync(join("shorts/lessons", `${id}.json`), `${JSON.stringify(lesson, null, 2)}\n`);
  writeFileSync(join("shorts/lessons", `${id}.review.md`), `${report}\n`);
  console.log(`\nSaved shorts/lessons/${id}.json and ${id}.review.md: ${supported} kept, ${noClaim} no-claim, ${dropped.length} dropped. ${lesson.approved ? `Approved for week ${lesson.week}.` : "Not approved."}`);
  for (const g of results) console.log(`  ${g.ok ? "✓" : "✗"} ${g.name}: ${g.detail}`);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `id=${id}\napproved=${lesson.approved ? "true" : "false"}\ntopic=${topic.replace(/\n/g, " ")}\n`);
}

if (process.argv[1]?.endsWith("lesson-draft.ts")) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
