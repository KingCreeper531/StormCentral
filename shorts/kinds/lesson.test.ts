import { describe, expect, it } from "vitest";
import { narration } from "../narration";
import { draftedLessons, LESSONS, lessonVideo, nextFreeWeek, pickLesson, SERIES_START, seriesWeek, stamp, timeline, validLesson, type StormSpec } from "./lesson";

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
    expect(pickLesson(SERIES_START - 1)).toBeNull();
    expect(pickLesson(SERIES_START + 3600_000)).toBe(0);
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
