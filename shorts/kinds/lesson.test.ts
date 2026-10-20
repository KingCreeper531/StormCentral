import { describe, expect, it } from "vitest";
import { narration } from "../narration";
import { LESSONS, lessonVideo, pickLesson, SERIES_START, stamp, timeline } from "./lesson";

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
  it("posts lesson 1 in the series' first week, then one a week, then nothing once they're out", () => {
    expect(pickLesson(SERIES_START - 1)).toBeNull();
    expect(pickLesson(SERIES_START + 3600_000)).toBe(0);
    expect(pickLesson(SERIES_START + LESSONS.length * WEEK + 1)).toBeNull();
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
