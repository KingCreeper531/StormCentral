/**
 * Radar School (Wednesdays): a full-length lesson on reading weather radar,
 * 16:9 and several minutes long, in chapters. The examples are real storms
 * from NOAA's NEXRAD archive (radar-archive.ts) where one shows the feature,
 * and simulated ones (radar-sim.js, labelled, a new storm each episode) for
 * the rest. The scripts are written and checked by hand (lessons below); the
 * narrator reads them as written.
 *
 * Each week posts the next lesson in LESSONS, counted from SERIES_START;
 * once they're all out, no video until more are added. SHORTS_LESSON picks
 * one by number or id (manual runs).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DISCLAIMER, DISCLAIMER_ES, LINK_LINE, LINK_LINE_ES, SITE } from "../meta";
import { loadCase, type CaseData, type CaseSpec } from "../radar-archive";
import type { Kind, Video } from "../video";

/** The first Wednesday of the series (lesson 1). */
export const SERIES_START = Date.parse("2026-10-21T00:00:00Z");
const WEEK = 7 * 86_400_000;
/** How fast the narrator talks, to time each beat to its line. */
const WORDS_PER_SECOND = 2.6;
/** The silent end screen, long enough for YouTube's end-screen elements (5-20 s). */
export const OUTRO_SECONDS = 20;

type Product = "ref" | "vel" | "cc";
/**
 * Historic storms from the NEXRAD archive. Times are the scan to show (the
 * last volume starting at or before it); the picture is centred on the place.
 */
export const CASES: Record<string, CaseSpec> = {
  "moore-2013": { site: "KTLX", time: "2013-05-20T20:13:00Z", lat: 35.33, lon: -97.5, widthKm: 70, heightKm: 48, place: "Moore, Oklahoma", zone: "America/Chicago" },
  "mayfield-2021": { site: "KPAH", time: "2021-12-11T03:27:00Z", lat: 36.74, lon: -88.66, widthKm: 80, heightKm: 54, place: "Mayfield, Kentucky", zone: "America/Chicago" },
  "rolling-fork-2023": { site: "KDGX", time: "2023-03-25T01:05:00Z", lat: 32.9, lon: -90.88, widthKm: 80, heightKm: 54, place: "Rolling Fork, Mississippi", zone: "America/Chicago" },
  "iowa-derecho-2020": { site: "KDMX", time: "2020-08-10T16:30:00Z", lat: 41.65, lon: -93.5, widthKm: 230, heightKm: 156, res: 1, place: "The Iowa derecho", zone: "America/Chicago" },
};

export interface StormSpec {
  /** A simulated storm, or "case": a real one from CASES (with `fallback` drawn when the archive can't be reached). */
  kind: "supercell" | "multicell" | "bow" | "hail" | "case";
  case?: keyof typeof CASES;
  fallback?: StormSpec;
  /** Set per episode by lessonVideo; a beat can add an offset to get a different storm. */
  seed?: number;
  p?: Record<string, number | number[]>;
  product?: Product;
  anim?: { key: string; from: number; to: number; start?: number; over?: number };
  focus?: string;
  zoom?: number;
  extra?: "clutter" | "brightband" | "bugs";
  notes?: { at?: number; target: string; text?: string; r?: number; color?: string; side?: "left" | "right" }[];
}
export type Visual =
  | { type: "title" }
  | { type: "radar"; storm: StormSpec; highlight?: [number, number] }
  | { type: "split"; storm: StormSpec; left?: Product; right?: Product }
  | { type: "works"; phase: 0 | 1 | 2 | 3 }
  | { type: "drops" }
  | { type: "sweep"; storm: StormSpec }
  | { type: "tilts" }
  | { type: "beam"; marks?: number[]; storm?: boolean }
  | { type: "bullets"; heading: string; items: (string | { text: string; color?: string })[] };

export interface Beat {
  /** What the narrator says while this beat is on screen. */
  say: string;
  /** The line on screen beside it. */
  caption?: string;
  /** A key point added to the chapter's list on screen. */
  bullet?: string;
  visual: Visual;
  /** At least this long on screen, seconds. */
  min?: number;
}
export interface Chapter {
  title: string;
  beats: Beat[];
}
export interface Lesson {
  id: string;
  title: string;
  /** YouTube title. */
  youtube: string;
  es: { title: string; summary: string };
  summary: string;
  next?: string;
  thumb: { lines: string[]; visual: { storm: StormSpec } };
  chapters: Chapter[];
  tags: string[];
  /** Drafted lessons (shorts/lessons/*.json) only go out once a person has checked them and set this. */
  approved?: boolean;
  /** Where a drafted lesson's facts came from (listed in the description). */
  sources?: { title: string; url: string }[];
  /** The series week it posts in (0 = the week of SERIES_START); drafts get the next free week when approved. */
  week?: number;
  /** How a drafted lesson was checked, for the description: "auto" = quotes verified and a second model agreed. */
  checked?: "auto" | "person";
}

// ── The lessons ─────────────────────────────────────────────────────────────
// Rules of thumb are given as such; numbers are standard NWS / NEXRAD values.
const REF = [5, 80] as const;

const reflectivity: Lesson = {
  id: "radar-basics",
  week: 0,
  title: "How weather radar works",
  youtube: "How to Read Weather Radar: How It Works and What the Colors Mean | Radar School 1",
  summary:
    "How weather radar sees rain and hail, what reflectivity and dBZ mean, what each color on the radar means, how to read a storm's structure, and the things that fool people: ground clutter, the bright band, bugs and beam height.",
  es: {
    title: "Cómo leer el radar meteorológico: cómo funciona y qué significan los colores | Escuela de Radar 1",
    summary:
      "Cómo ve el radar la lluvia y el granizo, qué son la reflectividad y los dBZ, qué significa cada color, cómo leer la estructura de una tormenta y lo que confunde a la gente: ecos de tierra, la banda brillante, insectos y la altura del haz.",
  },
  next: "Radar velocity: seeing the wind",
  thumb: {
    lines: ["HOW TO READ", "RADAR"],
    visual: {
      storm: {
        kind: "case",
        case: "moore-2013",
        zoom: 1.6,
        focus: "couplet",
        notes: [{ target: "couplet", r: 4, color: "#ffd60a" }],
        fallback: { kind: "supercell", p: { hook: 1, notch: 1 }, zoom: 1.2, focus: "core", notes: [{ target: "hook", r: 5, color: "#ffd60a" }] },
      },
    },
  },
  tags: ["how to read weather radar", "weather radar", "reflectivity", "dBZ", "NEXRAD", "radar colors", "storm spotting", "meteorology", "severe weather", "Radar School", "Storm Central"],
  chapters: [
    {
      title: "Introduction",
      beats: [
        { visual: { type: "title" }, say: "Radar is the most useful tool there is for watching storms. In this lesson, you'll learn how weather radar works, and how to read what it shows you.", min: 7 },
        {
          visual: { type: "radar", storm: { kind: "case", case: "mayfield-2021", fallback: { kind: "multicell" } } },
          caption: "Real storms from NOAA's radar archive",
          say: "Most of the radar in this video is real, straight from NOAA's archive of past storms. A few examples are simulated to show one feature clearly, and they're labelled.",
        },
        {
          visual: { type: "bullets", heading: "In this lesson", items: ["How radar sees rain and hail", "What reflectivity and dBZ mean", "What every color means", "How to read a storm", "Things that fool people"] },
          caption: "What we'll cover",
          say: "We'll cover how radar sees rain and hail, what the colors mean, how to read a storm's structure, and the mistakes that fool a lot of people.",
          min: 8,
        },
      ],
    },
    {
      title: "How weather radar works",
      beats: [
        {
          visual: { type: "works", phase: 0 },
          caption: "NEXRAD: about 160 radars across the U.S.",
          bullet: "About 160 NEXRAD radars cover the U.S.",
          say: "The National Weather Service and its partners run a network of about 160 radars across the U.S., called NEXRAD. Each one is a big dish inside a white dome.",
        },
        {
          visual: { type: "works", phase: 1 },
          caption: "The dish sends short pulses of microwave energy",
          bullet: "It sends pulses, then listens",
          say: "The dish sends out short, powerful pulses of microwave energy, then listens. It spends almost all of its time listening, not transmitting.",
        },
        {
          visual: { type: "works", phase: 2 },
          caption: "Rain, hail and snow scatter a little energy back",
          say: "When a pulse hits raindrops, hail or snowflakes, a tiny fraction of that energy scatters back toward the dish.",
        },
        {
          visual: { type: "works", phase: 3 },
          caption: "Echo time gives the distance, the dish's direction gives where",
          bullet: "Echo time gives distance",
          say: "The radar times how long each echo takes to come back. That tells it how far away the rain is, and the way the dish is pointing tells it where.",
        },
        {
          visual: { type: "drops" },
          caption: "Drop size matters most",
          bullet: "Twice as wide: about 64 times the echo",
          say: "How strong the echo is depends mostly on the size of the drops. A drop twice as wide sends back about 64 times more energy.",
        },
        {
          visual: { type: "drops" },
          caption: "A few big drops or hailstones can outshine many small ones",
          say: "That's why a few big drops or hailstones can light up the radar more than a sky full of tiny ones.",
        },
        {
          visual: { type: "sweep", storm: { kind: "multicell" } },
          caption: "The dish turns in a full circle…",
          bullet: "A full 3D scan every few minutes",
          say: "The dish turns in a full circle, then tilts up a little and turns again, building a 3D picture of the sky every few minutes.",
          min: 7,
        },
        {
          visual: { type: "tilts" },
          caption: "…at angles from 0.5° up to 19.5°",
          bullet: "Apps usually show the 0.5° scan",
          say: "The tilts run from 0.5 degrees, about half a degree above the horizon, up to 19.5 degrees. The lowest one is what most radar apps show you.",
          min: 7,
        },
        {
          visual: { type: "works", phase: 2 },
          caption: "Radar sees precipitation, not clouds",
          bullet: "It sees rain, hail and snow, not clouds",
          say: "One more thing: radar doesn't see clouds. Cloud droplets are far too small. It sees precipitation, and sometimes bugs, birds and dust in clear air.",
        },
      ],
    },
    {
      title: "Reflectivity and the color scale",
      beats: [
        {
          visual: { type: "radar", storm: { kind: "multicell" } },
          caption: "Reflectivity: how much energy comes back, in dBZ",
          bullet: "Reflectivity is measured in dBZ",
          say: "The most common radar image is reflectivity: how much energy bounces back, measured in a unit called dBZ.",
        },
        {
          visual: { type: "radar", storm: { kind: "multicell" } },
          caption: "Every 10 dBZ is about 10 times more energy",
          bullet: "Each 10 dBZ is 10 times the energy",
          say: "dBZ is a logarithmic scale, a bit like the one for earthquakes. Every 10 dBZ means about 10 times more energy coming back.",
        },
        {
          visual: { type: "radar", storm: { kind: "case", case: "iowa-derecho-2020", fallback: { kind: "multicell" } }, highlight: [REF[0], 20] },
          caption: "Below 20 dBZ: drizzle, very light rain, or bugs",
          say: "Below about 20 dBZ, in blues and the faintest greens, you're looking at drizzle, very light rain, or even insects in clear air.",
        },
        {
          visual: { type: "radar", storm: { kind: "case", case: "iowa-derecho-2020", fallback: { kind: "multicell" } }, highlight: [20, 35] },
          caption: "20 to 35 dBZ: light to moderate rain",
          bullet: "Green: light to moderate rain",
          say: "Greens, from about 20 to 35 dBZ, are light to moderate rain. Steady, but not intense.",
        },
        {
          visual: { type: "radar", storm: { kind: "case", case: "iowa-derecho-2020", fallback: { kind: "multicell" } }, highlight: [35, 50] },
          caption: "35 to 50 dBZ: moderate to heavy rain",
          bullet: "Yellow and orange: heavy rain",
          say: "Yellows and oranges, roughly 35 to 50 dBZ, are moderate to heavy rain. Thunderstorms usually show up here.",
        },
        {
          visual: { type: "radar", storm: { kind: "case", case: "iowa-derecho-2020", fallback: { kind: "multicell" } }, highlight: [50, 65] },
          caption: "50 to 65 dBZ: very heavy rain, hail possible",
          bullet: "Red: very heavy rain, hail possible",
          say: "Reds, from about 50 to 65 dBZ, mean very heavy rain. At this level, hail becomes possible, and flash flooding can develop quickly.",
        },
        {
          visual: { type: "radar", storm: { kind: "case", case: "mayfield-2021", fallback: { kind: "multicell" } }, highlight: [65, REF[1]] },
          caption: "65 dBZ and up: hail likely",
          bullet: "Pink, purple, white: hail likely",
          say: "Pinks, purples and whites, around 65 dBZ and higher, almost always mean hail is in the storm.",
        },
        {
          visual: { type: "radar", storm: { kind: "multicell" } },
          caption: "Rules of thumb: always check your app's legend",
          say: "These ranges are rules of thumb, and different apps use slightly different colors, so always check the legend.",
        },
      ],
    },
    {
      title: "Reading a storm",
      beats: [
        {
          visual: { type: "radar", storm: { kind: "case", case: "rolling-fork-2023", zoom: 1.4, focus: "core", notes: [{ target: "core", r: 4, text: "Core" }], fallback: { kind: "multicell", zoom: 1.3, focus: "core", notes: [{ target: "core", r: 6, text: "Core" }] } } },
          caption: "The core: the heaviest rain and any hail",
          bullet: "The brightest colors mark the core",
          say: "Now let's read a real storm: the one that hit Rolling Fork, Mississippi, in 2023. The brightest colors mark the core, where the heaviest rain and any hail are falling.",
        },
        {
          visual: { type: "radar", storm: { kind: "multicell", zoom: 1.3, focus: "core", notes: [{ target: "edge", r: 4, text: "Tight color change", color: "#ffd60a" }] } },
          caption: "Tight color changes mean a strong updraft",
          bullet: "Tight color changes: a strong updraft",
          say: "Look at how quickly the colors change. A sharp jump from green to red over a short distance points to a strong, concentrated updraft.",
        },
        {
          visual: { type: "radar", storm: { kind: "case", case: "iowa-derecho-2020", fallback: { kind: "multicell", notes: [{ target: "light", r: 10, text: "Steady, lighter rain", color: "#6cc4ff" }] } } },
          caption: "Soft, spread-out greens: steady, lighter rain",
          bullet: "Broad greens: steady, lighter rain",
          say: "Softer, spread-out greens are steadier, lighter rain, called stratiform rain, often trailing behind the strongest storms.",
        },
        {
          visual: { type: "radar", storm: { kind: "supercell", p: { hook: 0.35, notch: 0.5 }, zoom: 1.2, focus: "core", notes: [{ target: "core", r: 6, text: "Compact core" }] } },
          caption: "A compact, isolated storm is often a strong one",
          say: "Shape matters too. An isolated storm with a sharp, compact core is often stronger than a broad, ragged area of rain.",
        },
        {
          visual: {
            type: "radar",
            storm: {
              kind: "case",
              case: "moore-2013",
              zoom: 1.3,
              focus: "couplet",
              notes: [{ target: "couplet", r: 4, text: "Hook echo", color: "#ff453a" }],
              fallback: { kind: "supercell", p: { hook: 1, notch: 1 }, zoom: 1.2, focus: "core", notes: [{ target: "hook", r: 4.5, text: "Hook echo", color: "#ff453a" }] },
            },
          },
          caption: "Some shapes have special meanings, like a hook",
          bullet: "Shapes matter: hooks, bows, lines",
          say: "Some shapes have special meanings, like this hook from the storm that struck Moore, Oklahoma, in 2013. We'll spend a whole lesson on hooks.",
        },
        {
          visual: { type: "radar", storm: { kind: "case", case: "iowa-derecho-2020", fallback: { kind: "bow", p: { bow: 1, notch: 1 }, notes: [{ target: "apex", r: 5, text: "Bow echo", color: "#ff9f0a" }] } } },
          caption: "A line bowing forward: damaging winds",
          say: "A line of storms that bulges forward into a bow, like the 2020 Iowa derecho seen here, can bring damaging straight-line winds. That's another lesson coming up.",
        },
        {
          visual: { type: "radar", storm: { kind: "supercell", p: { hook: 0.6, notch: 0.8 } } },
          caption: "Every scan is a few minutes old",
          bullet: "Every scan is a few minutes old",
          say: "Remember that every scan is a few minutes old by the time you see it. Storms keep moving, so always think about where they're heading.",
        },
      ],
    },
    {
      title: "Things that fool people",
      beats: [
        {
          visual: { type: "radar", storm: { kind: "multicell", extra: "clutter", focus: "radar", zoom: 1.6, notes: [{ target: "radar", r: 14, text: "Ground clutter", color: "#ffd60a" }] } },
          caption: "Ground clutter: speckles around the radar that never move",
          bullet: "Clutter near the radar never moves",
          say: "Right around the radar site, you might see speckles that never move. That's ground clutter, echoes from buildings, trees and hills.",
        },
        {
          visual: { type: "radar", storm: { kind: "multicell", extra: "brightband", focus: "radar", zoom: 0.75 } },
          caption: "The bright band: melting snow looks like heavy rain",
          bullet: "A ring in cool weather: the bright band",
          say: "In cool weather, a ring of higher reflectivity around the radar can be snow melting as it falls. Wet snowflakes look huge to the radar. It's called the bright band.",
        },
        {
          visual: { type: "radar", storm: { kind: "multicell", extra: "bugs", focus: "radar", zoom: 0.8 } },
          caption: "A faint haze around the radar on calm nights: bugs and birds",
          bullet: "Faint haze on calm nights: bugs, birds",
          say: "On calm evenings, a faint blue or green haze spreading out around the radar is often insects and birds, not rain.",
        },
        {
          visual: { type: "beam", marks: [60, 120] },
          caption: "Far from the radar, the beam is high above the ground",
          bullet: "Far away, the beam is high up",
          say: "And far from the radar, the beam is thousands of feet up. It can overshoot light rain and the lowest part of a storm. We'll dig into that in a future lesson.",
          min: 8,
        },
      ],
    },
    {
      title: "Recap",
      beats: [
        {
          visual: {
            type: "bullets",
            heading: "Recap",
            items: [
              "Radar sends pulses and times the echoes",
              "Bigger drops send back much more energy",
              { text: "Green: light to moderate rain", color: "#01c501" },
              { text: "Yellow and orange: heavy rain", color: "#fd9500" },
              { text: "Red: very heavy rain, hail possible", color: "#fd0000" },
              { text: "Pink, purple, white: hail likely", color: "#f800fd" },
            ],
          },
          caption: "What to remember",
          say: "Let's recap. Radar sends out pulses and times the echoes, and bigger drops send back much more energy. Green is light rain, yellow and orange are heavier, red is very heavy, and pink, purple or white usually means hail.",
          min: 14,
        },
        {
          visual: { type: "radar", storm: { kind: "supercell", p: { hook: 1, notch: 1 }, zoom: 1.2, focus: "core" } },
          caption: "Next week: radar velocity",
          say: "Next week: radar velocity, and how to see the wind inside a storm. Subscribe so you don't miss it.",
        },
      ],
    },
  ],
};

// ── Drafted lessons (lesson-draft.ts) ───────────────────────────────────────

const TARGETS: Record<string, string[]> = {
  supercell: ["core", "hook", "meso", "notch", "couplet", "debris", "ffd", "tip"],
  multicell: ["core", "light", "edge", "moderate"],
  bow: ["apex", "notch", "north", "south"],
  hail: ["core", "spike", "toward"],
  case: ["core", "couplet", "debris"],
};
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** A storm spec from a draft, kept to what the simulator and the archive can draw. */
function validStorm(raw: unknown): StormSpec {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind = (["supercell", "multicell", "bow", "hail", "case"] as const).find((k) => k === o.kind) ?? "supercell";
  const isCase = kind === "case" && typeof o.case === "string" && o.case in CASES;
  const k = isCase ? "case" : kind === "case" ? "supercell" : kind;
  const product = (["ref", "vel", "cc"] as const).find((p) => p === o.product);
  const notes = (Array.isArray(o.notes) ? o.notes : [])
    .map((n) => (n && typeof n === "object" ? (n as Record<string, unknown>) : {}))
    .filter((n) => typeof n.target === "string" && TARGETS[k]!.includes(n.target))
    .slice(0, 3)
    .map((n) => ({ target: n.target as string, text: str(n.text, 28) || undefined, r: 4.5 }));
  const p: Record<string, number> = k === "supercell" ? { hook: 1, notch: 1, ...(notes.some((n) => n.target === "debris") || product === "cc" ? { debris: 1 } : {}) } : k === "bow" ? { bow: 1, notch: 1 } : k === "hail" ? { spike: 1 } : {};
  const spec: StormSpec = { kind: k, ...(Object.keys(p).length ? { p } : {}), ...(product ? { product } : {}), ...(notes.length ? { notes } : {}) };
  return isCase ? { ...spec, case: o.case as string, fallback: { kind: "supercell", p: { hook: 1, notch: 1, debris: product === "cc" ? 1 : 0 }, ...(product ? { product } : {}) } } : spec;
}

/** A visual from a draft, or a text card with the caption when it isn't one lesson.html can draw. */
function validVisual(raw: unknown, caption: string): Visual {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  switch (o.type) {
    case "title":
    case "drops":
    case "tilts":
      return { type: o.type };
    case "works":
      return { type: "works", phase: ([0, 1, 2, 3] as const).find((p) => p === o.phase) ?? 1 };
    case "beam":
      return { type: "beam", marks: [60, 120] };
    case "sweep":
      return { type: "sweep", storm: { kind: "multicell" } };
    case "radar":
      return { type: "radar", storm: validStorm(o.storm) };
    case "bullets": {
      const items = (Array.isArray(o.items) ? o.items : []).map((i) => str(i, 60)).filter(Boolean).slice(0, 6);
      if (items.length) return { type: "bullets", heading: str(o.heading, 40) || caption, items };
    }
  }
  return { type: "bullets", heading: caption || "Radar School", items: [caption].filter(Boolean) };
}

/** A lesson read from JSON, checked and trimmed to what the page can show; throws when it isn't a lesson. */
export function validLesson(raw: unknown): Lesson {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const id = str(o.id, 60).toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const title = str(o.title, 80);
  if (!id || !title) throw new Error("A lesson needs an id and a title");
  const chapters = (Array.isArray(o.chapters) ? o.chapters : [])
    .map((c) => (c && typeof c === "object" ? (c as Record<string, unknown>) : {}))
    .map((c) => ({
      title: str(c.title, 60),
      beats: (Array.isArray(c.beats) ? c.beats : [])
        .map((b) => (b && typeof b === "object" ? (b as Record<string, unknown>) : {}))
        .filter((b) => str(b.say, 400))
        .map((b): Beat => {
          const caption = str(b.caption, 70);
          return { say: str(b.say, 400), ...(caption ? { caption } : {}), ...(str(b.bullet, 45) ? { bullet: str(b.bullet, 45) } : {}), visual: validVisual(b.visual, caption), ...(typeof b.min === "number" ? { min: Math.min(30, Math.max(5, b.min)) } : {}) };
        }),
    }))
    .filter((c) => c.title && c.beats.length);
  if (chapters.length < 3) throw new Error(`Lesson ${id} needs at least 3 chapters`);
  const es = (o.es && typeof o.es === "object" ? o.es : {}) as Record<string, unknown>;
  const thumb = (o.thumb && typeof o.thumb === "object" ? o.thumb : {}) as Record<string, unknown>;
  const thumbStorm = ((thumb.visual && typeof thumb.visual === "object" ? thumb.visual : {}) as Record<string, unknown>).storm;
  return {
    id,
    title,
    youtube: str(o.youtube, 100) || `${title} | Radar School`,
    summary: str(o.summary, 600),
    es: { title: str(es.title, 100) || `${title} | Escuela de Radar`, summary: str(es.summary, 600) || str(o.summary, 600) },
    ...(str(o.next, 80) ? { next: str(o.next, 80) } : {}),
    thumb: { lines: (Array.isArray(thumb.lines) ? thumb.lines : [title.toUpperCase()]).map((l) => str(l, 16)).filter(Boolean).slice(0, 3), visual: { storm: validStorm(thumbStorm) } },
    chapters,
    tags: (Array.isArray(o.tags) ? o.tags : []).map((t) => str(t, 40)).filter(Boolean).slice(0, 15),
    approved: o.approved === true,
    ...(typeof o.week === "number" && Number.isInteger(o.week) && o.week >= 0 ? { week: o.week } : {}),
    ...(o.checked === "auto" || o.checked === "person" ? { checked: o.checked } : {}),
    ...(Array.isArray(o.sources) ? { sources: o.sources.map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : {})).map((s) => ({ title: str(s.title, 120), url: str(s.url, 300) })).filter((s) => /^https:\/\//.test(s.url)) } : {}),
  };
}

/** Drafted lessons in shorts/lessons/ (approved ones only, unless `all`), in file-name order. */
export function draftedLessons(dir = "shorts/lessons", all = false): Lesson[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => validLesson(JSON.parse(readFileSync(join(dir, f), "utf8"))))
    .filter((l) => all || l.approved);
}

/** The series in order of the weeks they post: the hand-written lessons and approved drafts. */
export const LESSONS: Lesson[] = [reflectivity, ...draftedLessons()].sort((a, b) => (a.week ?? 1e9) - (b.week ?? 1e9));

/** The series week of `now` (0 = the week of SERIES_START, from Wednesday 00:00 UTC). */
export const seriesWeek = (now: number) => Math.floor((now - SERIES_START) / WEEK);

/** The week a newly approved draft gets: the first week after both now and every lesson already scheduled. */
export const nextFreeWeek = (now: number, lessons: Lesson[] = LESSONS) => Math.max(seriesWeek(now) + 1, ...lessons.map((l) => (l.week ?? -1) + 1));

// ── Building a lesson's video ───────────────────────────────────────────────

const words = (s: string) => s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
/** How long a beat stays on screen: its line read aloud, a breath, and its minimum. */
export const beatSeconds = (b: Beat) => Math.max(b.min ?? 5, words(b.say) / WORDS_PER_SECOND + 1.1);

/** "1:05" for a chapter start. */
export const stamp = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function timeline(lesson: Lesson) {
  let t = 0;
  const chapters: { title: string; start: number; end: number }[] = [];
  const beats: (Omit<Beat, "min"> & { start: number; dur: number; chapter: number })[] = [];
  lesson.chapters.forEach((ch, ci) => {
    const start = t;
    for (const b of ch.beats) {
      const dur = beatSeconds(b);
      beats.push({ say: b.say, caption: b.caption, bullet: b.bullet, visual: b.visual, start: t, dur, chapter: ci });
      t += dur;
    }
    chapters.push({ title: ch.title, start, end: t });
  });
  return { chapters, beats, end: t };
}

/** The case ids a lesson shows (thumbnail included). */
export function casesIn(lesson: Lesson): string[] {
  const out = new Set<string>();
  JSON.stringify(lesson, (k, v) => (k === "case" && typeof v === "string" ? (out.add(v), v) : v));
  return [...out];
}

/** Real storms the archive gave us stay; the rest become their simulated fallback. */
function resolveCases<T>(x: T, have: Record<string, unknown>): T {
  if (Array.isArray(x)) return x.map((y) => resolveCases(y, have)) as T;
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    if (o.kind === "case" && !(typeof o.case === "string" && have[o.case])) return resolveCases(o.fallback, have) as T;
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, resolveCases(v, have)])) as T;
  }
  return x;
}

/** Seeds every storm in the lesson from the episode's seed, so each episode's examples are new. */
function seeded<T>(x: T, seed: number): T {
  if (Array.isArray(x)) return x.map((y) => seeded(y, seed)) as T;
  if (x && typeof x === "object") {
    const o = Object.fromEntries(Object.entries(x).map(([k, v]) => [k, seeded(v, seed)])) as Record<string, unknown>;
    if (typeof o.kind === "string" && ["supercell", "multicell", "bow", "hail"].includes(o.kind)) o.seed = seed + ((o.seed as number) || 0);
    return o as T;
  }
  return x;
}

export function lessonVideo(lesson: Lesson, n: number, seed: number, cases: Record<string, CaseData> = {}): Video {
  const shown = seeded(resolveCases(lesson, cases), seed);
  const tl = timeline(shown);
  const used = Object.fromEntries(casesIn(shown).map((id) => [id, cases[id]!]));
  const anyReal = Object.keys(used).length > 0;
  const realLine = anyReal
    ? `Real radar in this video, from NOAA's NEXRAD Level II archive: ${Object.values(used)
        .map((c) => `${c.place} (${c.site}, ${c.label})`)
        .join("; ")}. Examples marked "simulated example" are drawn for the lesson.`
    : "The radar images in this video are simulated examples, drawn for the lesson so each feature is easy to see; real radar works the same way.";
  const chapterLines = tl.chapters.map((c) => `${stamp(c.start)} ${c.title}`).concat(`${stamp(tl.end)} End`);
  const chapterLinesEs = chapterLines; // the chapter names stay as on screen
  return {
    key: `lesson-${lesson.id}`,
    template: "lesson.html",
    title: lesson.youtube,
    description: [
      `${lesson.summary}`,
      `Radar School is a free weekly series on reading weather radar. ${realLine}`,
      `Chapters:\n${chapterLines.join("\n")}`,
      ...(lesson.sources?.length ? [`Sources:\n${lesson.sources.map((s) => `${s.title}: ${s.url}`).join("\n")}`] : []),
      ...(lesson.checked === "auto"
        ? ["How this lesson was made: the script was drafted by an AI model from the sources above, every factual line was checked against a quote from them, and a second AI model reviewed each line. Spot a mistake? Tell us in the comments."]
        : []),
      `Watch live radar, warnings and storm reports, free: ${SITE}`,
      LINK_LINE,
      DISCLAIMER,
      "#weather #radar #weatherradar #meteorology #severeweather #education",
    ].join("\n\n"),
    tags: lesson.tags,
    es: {
      title: lesson.es.title,
      description: [
        lesson.es.summary,
        anyReal
          ? "La Escuela de Radar es una serie semanal y gratuita sobre cómo leer el radar meteorológico. El radar real viene del archivo NEXRAD Nivel II de la NOAA; los ejemplos marcados como simulados se dibujaron para la lección."
          : "La Escuela de Radar es una serie semanal y gratuita sobre cómo leer el radar meteorológico. Las imágenes de radar de este video son ejemplos simulados, dibujados para la lección; el radar real funciona igual.",
        `Capítulos:\n${chapterLinesEs.join("\n")}`,
        LINK_LINE_ES,
        DISCLAIMER_ES,
        "#clima #radar #meteorología #tormentas #educación",
      ].join("\n\n"),
    },
    playlist: "Radar School",
    size: { width: 1920, height: 1080 },
    thumbnailAt: 0,
    data: {
      lesson: { n, title: lesson.title },
      chapters: tl.chapters,
      beats: tl.beats,
      end: tl.end,
      outro: { next: lesson.next },
      outroSeconds: OUTRO_SECONDS,
      thumb: shown.thumb,
      cases: used,
      anyReal,
    },
  };
}

/** Which lesson this week is (0-based), from the series start; manual runs can name one. */
export function pickLesson(now: number, pick?: string): number | null {
  if (pick?.trim()) {
    const p = pick.trim().toLowerCase();
    const i = /^\d+$/.test(p) ? Number(p) - 1 : LESSONS.findIndex((l) => l.id === p);
    return i >= 0 && i < LESSONS.length ? i : null;
  }
  const week = seriesWeek(now);
  const i = LESSONS.findIndex((l) => l.week === week);
  return i >= 0 ? i : null;
}

export const lessonKind: Kind = async (ctx) => {
  const now = Date.now();
  let i = pickLesson(now, ctx.env.SHORTS_LESSON);
  // A manual run with no lesson named makes the newest one that's out (or the first).
  if (i == null && ctx.env.SHORTS_LATEST === "1" && !ctx.env.SHORTS_LESSON) i = Math.max(0, LESSONS.findLastIndex((l) => (l.week ?? 0) <= seriesWeek(now)));
  if (i == null) {
    console.log(ctx.env.SHORTS_LESSON ? `No lesson "${ctx.env.SHORTS_LESSON}".` : "No Radar School lesson scheduled this week (the weekly draft didn't pass its checks, or none was drafted).");
    return [];
  }
  // A new storm for every week, the same one for every run of that week.
  const seed = 1000 + Math.floor(now / WEEK);
  const lesson = LESSONS[i]!;
  console.log(`Radar School lesson ${i + 1}: ${lesson.title} (seed ${seed}).`);
  // Real storms from the archive; one that can't be loaded is swapped for its simulated stand-in.
  const cases: Record<string, CaseData> = {};
  for (const id of casesIn(lesson)) {
    const spec = CASES[id];
    if (!spec) continue;
    try {
      cases[id] = await loadCase(spec);
    } catch (err) {
      console.warn(`::warning::Couldn't load the ${id} radar; using a simulated example instead: ${err instanceof Error ? err.message : err}`);
    }
  }
  return [lessonVideo(lesson, i + 1, seed, cases)];
};
