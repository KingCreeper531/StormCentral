import { describe, expect, it } from "vitest";
import { checkEvidence, htmlText, norm, relevant, verifyQuote, type Source } from "./research";

const noaa: Source = {
  title: "JetStream: Doppler radar",
  url: "https://www.weather.gov/jetstream/doppler",
  kind: "noaa",
  text: "The radar sends out pulses of energy. Green colors indicate motion toward the radar, while red colors indicate motion away from the radar.\n\nA drop twice as wide returns 64 times more energy to the radar.",
};
const wiki: Source = { title: "Wikipedia: Weather radar", url: "https://en.wikipedia.org/wiki/Weather_radar", kind: "wikipedia", text: "Weather radar, also called weather surveillance radar, is a type of radar used to locate precipitation." };
const sources = [noaa, wiki];

describe("htmlText", () => {
  it("keeps the words and paragraphs, not the markup, scripts or navigation", () => {
    const t = htmlText(`<html><head><style>p{}</style><script>var x=1</script></head><body><nav>Home</nav><h1>Radar</h1><p>Green means <b>toward</b> the radar&nbsp;&amp; red away.</p><p>Second &ldquo;quote&rdquo;</p></body></html>`);
    expect(t).toContain("Radar");
    expect(t).toContain("Green means toward the radar & red away.");
    expect(t).toContain('Second "quote"');
    expect(t).not.toMatch(/var x|Home|p\{\}/);
  });
});

describe("verifyQuote", () => {
  it("finds a quote that's in a source word for word, ignoring case, quotes and spacing", () => {
    expect(verifyQuote("green colors indicate motion  toward the radar", sources)).toBe(noaa);
    expect(verifyQuote("“Weather radar, also called weather surveillance radar”", sources)).toBe(wiki);
  });

  it("rejects quotes that were changed, made up or are too short to mean anything", () => {
    expect(verifyQuote("Green colors indicate motion away from the radar", sources)).toBeNull();
    expect(verifyQuote("Radar can see tornadoes from space with lasers.", sources)).toBeNull();
    expect(verifyQuote("the radar", sources)).toBeNull();
  });
});

describe("checkEvidence", () => {
  it("passes a line whose numbers and words are in a real quote", () => {
    const e = checkEvidence("A drop twice as wide sends back about 64 times more energy.", ["A drop twice as wide returns 64 times more energy to the radar."], sources);
    expect(e.verdict).toBe("supported");
    expect(e.quotes[0]!.source).toBe(noaa);
  });

  it("fails a line whose number isn't in its quote, even when the quote is real", () => {
    const e = checkEvidence("A drop twice as wide sends back 100 times more energy.", ["A drop twice as wide returns 64 times more energy to the radar."], sources);
    expect(e.verdict).toBe("unsupported");
    expect(e.why).toMatch(/100/);
  });

  it("fails a line with no quote, or with quotes that aren't in any source", () => {
    expect(checkEvidence("Radar sees clouds.", [], sources).verdict).toBe("unsupported");
    expect(checkEvidence("Radar sees clouds.", ["Radar can see every cloud in the sky."], sources).verdict).toBe("unsupported");
  });

  it("calls it weak when a real quote has little to do with the line", () => {
    const e = checkEvidence("Hail cores glow purple and white because ice is shiny and frozen solid.", ["The radar sends out pulses of energy."], sources);
    expect(e.verdict).toBe("weak");
  });
});

describe("relevant", () => {
  it("picks the passages about the topic, within the budget", () => {
    const got = relevant(sources, "velocity toward away from the radar colors", 500);
    expect(got[0]!.source).toBe(noaa);
    expect(got.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(500);
  });
});

describe("norm", () => {
  it("treats curly quotes, dashes and spacing alike", () => {
    expect(norm("“Hook”—echo  ")).toBe(norm('"hook" echo'));
  });
});
