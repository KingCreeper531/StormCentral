/**
 * Drafts a Radar School lesson on a topic with the local model (Ollama),
 * from sources it's given (research.ts: Wikipedia and NOAA/NWS pages), and
 * checks it: every factual line must come with a quote that really appears
 * in a source and carries the line's numbers (checkEvidence). A line that
 * fails is rewritten from its quotes once, then dropped. The draft is saved
 * unapproved (shorts/lessons/<id>.json) with a review report (<id>.review.md)
 * for a person to read before setting "approved": true; only approved
 * lessons are ever made into videos (kinds/lesson.ts).
 *
 * Run by the "Draft a Radar School lesson" workflow:
 *   npx tsx shorts/lesson-draft.ts --topic "radar velocity" --id velocity [--urls https://...,https://...]
 * Environment: OLLAMA_HOST, SHORTS_AI_MODEL (default gemma3:12b).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CASES, validLesson, type Lesson } from "./kinds/lesson";
import { checkEvidence, JETSTREAM_RADAR, pages, relevant, wikipedia, type Evidence, type Source } from "./research";

const env = process.env;
const MODEL = env.SHORTS_AI_MODEL || "gemma3:12b";
const HOST = (env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/^(?!https?:\/\/)/, "http://");

async function ask<T>(system: string, prompt: string, schema: object, { maxTokens = 1500, temperature = 0.4 } = {}): Promise<T> {
  const res = await fetch(`${HOST}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      keep_alive: "30m",
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

interface Checked {
  beat: DraftBeat;
  evidence: Evidence | null;
  dropped?: string;
}

async function main() {
  const arg = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const topic = arg("topic");
  const id = (arg("id") || topic || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!topic || !id) throw new Error('Usage: lesson-draft.ts --topic "radar velocity" --id velocity [--urls a,b]');
  const extra = (arg("urls") || "").split(",").map((s) => s.trim()).filter(Boolean);

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

  // 3. The lesson: an introduction and a recap around the checked lines.
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
    sources: unique.map((s) => ({ title: s.title, url: s.url })),
  };
  const lesson: Lesson = validLesson(lessonRaw);

  // 4. The review report.
  const all = chapters.flatMap((c) => c.checked.map((x) => ({ ...x, chapter: c.title })));
  const supported = all.filter((x) => x.evidence?.verdict === "supported").length;
  const noClaim = all.filter((x) => !x.evidence).length;
  const dropped = all.filter((x) => x.dropped);
  const report = [
    `# Review: ${lesson.title}`,
    "",
    `Drafted by ${MODEL} from the sources below. **Not approved**: read every line, then set \`"approved": true\` in \`shorts/lessons/${id}.json\` to schedule it.`,
    "",
    `- ${supported} lines backed by a quote found word for word in a source`,
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
      const head = `- ${x.dropped ? "❌ **Dropped**" : x.evidence ? "✅" : "➖ no claim"} (${x.chapter}) ${x.beat.say}`;
      const q = (x.evidence?.quotes ?? []).map((q) => `  > ${q.text}\n  > — [${q.source.title}](${q.source.url})${q.source.kind === "wikipedia" ? " ⚠️ Wikipedia only" : ""}`);
      return [head, ...(x.dropped ? [`  Why: ${x.dropped}`] : []), ...q].join("\n");
    }),
  ].join("\n");

  mkdirSync("shorts/lessons", { recursive: true });
  writeFileSync(join("shorts/lessons", `${id}.json`), `${JSON.stringify(lesson, null, 2)}\n`);
  writeFileSync(join("shorts/lessons", `${id}.review.md`), `${report}\n`);
  console.log(`\nSaved shorts/lessons/${id}.json and ${id}.review.md: ${supported} backed, ${noClaim} no-claim, ${dropped.length} dropped.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
