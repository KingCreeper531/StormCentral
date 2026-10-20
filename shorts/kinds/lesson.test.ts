import { describe, expect, it } from "vitest";
import { narration } from "../narration";
import type { Screens } from "../app-capture";
import { draftedLessons, LESSONS, lessonVideo, nextFreeWeek, pickLesson, screensIn, SERIES_START, seriesWeek, stamp, timeline, validLesson, type StormSpec } from "./lesson";

const WEEK = 7 * 86_400_000;
const numbers = (s: string) => (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, ""));

describe("Radar School lessons", () => {
  for (const [i, lesson] of LESSONS.entries()) {
    describe(lesson.title, () => {
      const v = lessonVideo(lesson, i + 1, 1234);
      const tl = timeline(lesson);

      it("plays its beats back to back, in chapters that cover the lesson", () => {
        let t = 0;
        for (const b of tl.beats) {
          expect(b.start).toBeCloseTo(t, 6);
          expect(b.dur).toBeGreaterThanOrEqual(5);
          t += b.dur;
        }
        expect(tl.chapters[0]!.start).toBe(0);
        expect(tl.chapters.at(-1)!.end).toBeCloseTo(tl.end, 6);
        // A full-length video, not a Short.
        expect(tl.end).toBeGreaterThan(180);
      });

      it("meets YouTube's rules for chapters: from 0:00, three or more, each at least 10 seconds", () => {
        const lines = v.description.split("Chapters:\n")[1]!.split("\n\n")[0]!.split("\n");
        expect(lines[0]).toMatch(/^0:00 /);
        expect(tl.chapters.length).toBeGreaterThanOrEqual(3);
        for (const c of tl.chapters) expect(c.end - c.start).toBeGreaterThanOrEqual(10);
      });

      it("fits YouTube's limits", () => {
        expect(v.title.length).toBeLessThanOrEqual(100);
        expect(v.es.title.length).toBeLessThanOrEqual(100);
        expect(v.description.length).toBeLessThan(5000);
        expect(v.tags.join(",").length).toBeLessThan(500);
        expect(v.title).not.toMatch(/#shorts/i);
      });

      it("keeps the screen and the narrator saying the same numbers", () => {
        for (const ch of lesson.chapters)
          for (const b of ch.beats) {
            const said = numbers(b.say);
            for (const n of [...numbers(b.caption ?? ""), ...numbers(b.bullet ?? "")]) expect(said, `${b.caption ?? b.bullet} vs "${b.say}"`).toContain(n);
          }
      });

      it("keeps on-screen text short enough to read", () => {
        for (const ch of lesson.chapters)
          for (const b of ch.beats) {
            expect((b.caption ?? "").length, b.caption).toBeLessThanOrEqual(70);
            expect((b.bullet ?? "").length, b.bullet).toBeLessThanOrEqual(45);
          }
      });

      it("gives every beat a line for the narrator, timed to it", () => {
        const cues = narration(v);
        expect(cues).toHaveLength(tl.beats.length);
        cues.forEach((c, k) => expect(c.at).toBeCloseTo(tl.beats[k]!.start + 0.3, 6));
        expect(cues.some((c) => /D B Z/.test(c.text))).toBe(true);
        expect(cues.every((c) => !/dBZ/.test(c.text))).toBe(true);
      });

      it("seeds every storm from the episode, so each episode's examples are new", () => {
        const a = JSON.stringify(lessonVideo(lesson, 1, 1).data), b = JSON.stringify(lessonVideo(lesson, 1, 2).data);
        expect(a).not.toBe(b);
        expect(a).toMatch(/"seed":1\b/);
      });
    });
  }
});

describe("pickLesson", () => {
  it("posts each lesson in its own week, and nothing in a week without one", () => {
    // Lesson 1 went out by hand the week before the schedule began, so week 0 has nothing of its own.
    expect(pickLesson(SERIES_START - 1)).toBe(0);
    expect(pickLesson(SERIES_START + 3600_000)).toBeNull();
    expect(LESSONS[pickLesson(SERIES_START + WEEK + 3600_000)!]!.id).toBe("professional-mode");
    expect(pickLesson(SERIES_START + 500 * WEEK)).toBeNull();
  });

  it("gives a new draft the first week after now and after every lesson already scheduled", () => {
    const at = (w: number) => SERIES_START + w * WEEK + 3600_000;
    expect(nextFreeWeek(at(0), [{ week: 0 } as never])).toBe(1);
    expect(nextFreeWeek(at(0), [{ week: 0 } as never, { week: 3 } as never])).toBe(4);
    expect(nextFreeWeek(at(10), [{ week: 0 } as never])).toBe(11);
    expect(seriesWeek(at(2))).toBe(2);
  });

  it("takes a lesson by number or id", () => {
    expect(pickLesson(0, "1")).toBe(0);
    expect(pickLesson(0, LESSONS[0]!.id)).toBe(0);
    expect(pickLesson(0, "999")).toBeNull();
    expect(pickLesson(0, "no-such-lesson")).toBeNull();
  });
});

describe("stamp", () => {
  it("writes chapter times the way YouTube reads them", () => {
    expect(stamp(0)).toBe("0:00");
    expect(stamp(65.9)).toBe("1:05");
    expect(stamp(600)).toBe("10:00");
  });
});

describe("drafted lessons", () => {
  const draft = {
    id: "Radar Velocity!",
    title: "Radar velocity",
    youtube: "Radar Velocity Explained | Radar School",
    summary: "What velocity shows.",
    chapters: [
      { title: "Intro", beats: [{ say: "Hello.", visual: { type: "title" } }] },
      {
        title: "Colors",
        beats: [
          { say: "Green means toward the radar.", caption: "Green: toward", visual: { type: "radar", storm: { kind: "supercell", product: "vel", notes: [{ target: "couplet", text: "Couplet" }, { target: "nonsense" }] } } },
          { say: "A real storm.", caption: "Moore", visual: { type: "radar", storm: { kind: "case", case: "moore-2013", product: "vel" } } },
          { say: "Not a real case.", caption: "Made up", visual: { type: "radar", storm: { kind: "case", case: "nowhere-1999" } } },
          { say: "Something the page can't draw.", caption: "A hologram", visual: { type: "hologram" } },
          { say: "", caption: "empty" },
        ],
      },
      { title: "Recap", beats: [{ say: "Bye.", visual: { type: "bullets", heading: "Recap", items: ["Green toward", 5] } }] },
    ],
    approved: false,
    sources: [{ title: "JetStream", url: "https://www.weather.gov/jetstream/vel" }, { title: "bad", url: "javascript:alert(1)" }],
  };

  it("keeps a draft to what the page can draw, and leaves it unapproved", () => {
    const l = validLesson(draft);
    expect(l.id).toBe("radar-velocity-");
    expect(l.approved).toBe(false);
    const beats = l.chapters[1]!.beats;
    expect(beats).toHaveLength(4); // the empty line is gone
    const storm = (beats[0]!.visual as { storm: StormSpec }).storm;
    expect(storm.notes?.map((n) => n.target)).toEqual(["couplet"]);
    expect((beats[1]!.visual as { storm: StormSpec }).storm).toMatchObject({ kind: "case", case: "moore-2013", fallback: { kind: "supercell" } });
    expect((beats[2]!.visual as { storm: StormSpec }).storm.kind).toBe("supercell");
    expect(beats[3]!.visual).toEqual({ type: "bullets", heading: "A hologram", items: ["A hologram"] });
    expect(l.sources).toEqual([{ title: "JetStream", url: "https://www.weather.gov/jetstream/vel" }]);
  });

  it("refuses something that isn't a lesson", () => {
    expect(() => validLesson({})).toThrow();
    expect(() => validLesson({ id: "x", title: "X", chapters: [{ title: "One", beats: [{ say: "a" }] }] })).toThrow(/3 chapters/);
  });

  it("only schedules approved drafts, and every draft in shorts/lessons is a valid lesson", () => {
    const all = draftedLessons("shorts/lessons", true);
    expect(draftedLessons("shorts/lessons").every((l) => l.approved)).toBe(true);
    expect(LESSONS.slice(1).every((l) => l.approved)).toBe(true);
    for (const l of all) expect(timeline(l).end).toBeGreaterThan(0);
  });

  it("lists a drafted lesson's sources in its description", () => {
    const v = lessonVideo(validLesson({ ...draft, approved: true }), 2, 1);
    expect(v.description).toContain("Sources:\nJetStream: https://www.weather.gov/jetstream/vel");
  });
});

describe("app screens (the Professional mode lesson)", () => {
  const pro = LESSONS.find((l) => l.id === "professional-mode")!;
  const shot = (boxes: Record<string, [number, number, number, number]> = {}) => ({ img: "data:image/jpeg;base64,AA==", w: 1600, h: 900, boxes, points: {} });
  const screens: Screens = {
    at: "2026-10-28T16:40:00Z",
    where: { lat: 35.47, lon: -97.52, name: "Oklahoma City" },
    shots: { overview: shot({ tools: [460, 64, 520, 30], panes: [0, 100, 1220, 760] }), sounding: shot({ side: [1220, 100, 380, 760] }) },
    products: [{ group: "Radar (site)", items: ["REF · Base Reflectivity"] }],
  };

  it("lists every screen the lesson can show", () => {
    expect(screensIn(pro)).toEqual(expect.arrayContaining(["overview", "sounding", "xsect", "vector", "toa", "inspector", "warngen", "settings"]));
    expect(screensIn(LESSONS[0]!)).toEqual([]);
  });

  it("shows only screens that were recorded, falling back to the overview", () => {
    const v = lessonVideo(pro, 2, 1, {}, screens);
    const beats = (v.data as { beats: { visual: { type: string; shot?: string; focus?: string; fallback?: unknown } }[] }).beats;
    const shown = beats.filter((b) => b.visual.type === "screen");
    expect(shown.length).toBeGreaterThan(30);
    for (const b of shown) {
      expect(["overview", "sounding"]).toContain(b.visual.shot);
      expect(b.visual.fallback).toBeUndefined();
    }
    // The storm vector wasn't recorded (no storm): its beats show the overview's tool bar instead.
    const vectorBeat = beats[timeline(pro).beats.findIndex((b) => b.visual.type === "screen" && b.visual.shot === "vector")]!;
    expect(vectorBeat.visual).toMatchObject({ shot: "overview", focus: "tools" });
    const data = v.data as { screens: Screens; thumb: { visual: { shot?: string } } };
    expect(Object.keys(data.screens.shots).sort()).toEqual(["overview", "sounding"]);
    expect(data.thumb.visual.shot).toBe("overview");
  });

  it("says in the description when the screens were recorded, with no line about simulated radar", () => {
    const v = lessonVideo(pro, 2, 1, {}, screens);
    expect(v.description).toContain("Professional mode on live radar and model data, recorded October 28, 2026.");
    expect(v.description).not.toMatch(/simulated/);
    expect(v.es.description).toContain("grabadas el 28 de octubre de 2026");
  });

  it("turns screens into text cards when nothing was recorded", () => {
    const beats = (lessonVideo(pro, 2, 1).data as { beats: { visual: { type: string } }[]; screens?: unknown }).beats;
    expect(beats.some((b) => b.visual.type === "screen")).toBe(false);
    expect((lessonVideo(pro, 2, 1).data as { screens?: unknown }).screens).toBeUndefined();
  });
});
