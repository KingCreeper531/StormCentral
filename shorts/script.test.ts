import { describe, expect, it, vi } from "vitest";
import { spoken, type Cue } from "./narration";
import { background, buildPrompt, checkLine, digits, livelyNarration, parseLines, wordBudgets, type LineFacts } from "./script";
import { longestRewrite } from "./voice";

const facts = (scene: string, extra = "", words = 20): LineFacts => ({ scene, allowed: `${scene} ${extra}`.trim(), words });
const check = (line: string, f: LineFacts) => checkLine(spoken(digits(line, f.allowed)), f);

describe("checkLine", () => {
  const torn = facts("The tornado threat peaks at 10 percent.");

  it("passes a livelier line with the same facts", () => {
    expect(check("Tornadoes? The threat tops out at 10 percent, so keep an eye on the sky.", torn)).toBeNull();
    expect(check("It's an Enhanced Risk today, level 3 of 5, centered on the Southern Plains!", facts("The top risk today is an Enhanced Risk, level 3 of 5, for the Southern Plains."))).toBeNull();
  });

  it("rejects numbers, places and days that aren't in the facts", () => {
    expect(check("Tornado odds climb to 15 percent.", torn)).toMatch(/number 15/);
    expect(check("Storms could spin up near Wichita at 10 percent.", torn)).toMatch(/Wichita/);
    expect(check("Kansas has a 10 percent tornado threat.", torn)).toMatch(/Kansas/);
    expect(check("By Friday, tornado odds peak at 10 percent.", torn)).toMatch(/Friday/);
    expect(check("Tornado odds are up to fifteen percent.", torn)).toMatch(/number 15/);
    expect(check("Tornado odds are up to ten percent, a dozen times over.", torn)).toMatch(/dozen/);
  });

  it("catches a state code the reader would say as a state", () => {
    // spoken() reads "OK" as "Oklahoma".
    expect(check("OK, tornado odds peak at 10 percent.", torn)).toMatch(/Oklahoma/);
  });

  it("keeps the risk level, hazards, times of day and directions to the facts", () => {
    expect(check("It's a Moderate Risk day, level 3 of 5!", facts("The top risk today is an Enhanced Risk, level 3 of 5."))).toMatch(/Moderate/);
    expect(check("Monday brings a slight chance of storms.", facts("Monday, Marginal Risk."))).toMatch(/slight/);
    expect(check("Tornadoes peak at 10 percent, with hail too.", torn)).toMatch(/hail/);
    expect(check("Tornadoes peak at 10 percent this afternoon.", torn)).toMatch(/afternoon/);
    expect(check("Tornadoes peak at 10 percent this afternoon.", facts(torn.scene, "Storms form this afternoon."))).toBeNull();
    expect(check("It's heading northeast at 12 miles per hour.", facts("It's moving north at 12 mph."))).toMatch(/northeast/);
  });

  it("lets a clock time stand for its part of the day", () => {
    const by = facts("By Wednesday 5 PM, it's forecast to be a tropical depression.");
    expect(check("By Wednesday evening, it should be down to a tropical depression.", by)).toBeNull();
    expect(check("By Wednesday afternoon, it should be down to a tropical depression.", by)).toMatch(/afternoon/);
  });

  it("doesn't paint in weather the Short doesn't report, or movement it doesn't give", () => {
    expect(check("Tuesday looks lovely and quiet.", facts("Tuesday, quiet."))).toMatch(/lovely/);
    expect(check("Thursday stays sunny and quiet.", facts("Thursday, quiet."))).toMatch(/sunny/);
    const trudy = facts("It's a tropical storm with maximum winds of 40 mph.", "The storm: Tropical Storm Trudy.");
    expect(check("Tropical Storm Trudy is barely moving.", trudy)).toMatch(/moving/);
    expect(check("Trudy has 40 miles per hour winds and barely a wiggle in its movement.", trudy)).toMatch(/moving/);
    expect(check("Trudy is heading west with 40 miles per hour winds.", facts("It's a tropical storm with maximum winds of 40 mph, moving west at 7 mph."))).toBeNull();
    expect(check("Tuesday looks beautifully quiet.", facts("Tuesday, quiet."))).toMatch(/beautifully/);
    expect(check("Trudy is weakening, down to 40 miles per hour.", trudy)).toMatch(/weakening/);
    expect(check("Trudy is weakening, down to 40 miles per hour.", facts(trudy.scene, `${trudy.allowed} It is forecast to weaken.`))).toBeNull();
  });

  it("lets the opening line tease any fact, including a 'no'", () => {
    const hook: LineFacts = { scene: "Here's your outlook for Monday.", hook: true, allowed: "Here's your outlook for Monday. Tornadoes aren't expected.", words: 12 };
    expect(check("No tornadoes in sight this Monday, but let's dig in.", hook)).toBeNull();
    expect(check("Let's dig into Monday's outlook!", hook)).toBeNull();
  });

  it("keeps a 'no' a 'no', and doesn't add one", () => {
    expect(check("Tornadoes are on the table today.", facts("Tornadoes aren't expected."))).toMatch(/drops/);
    expect(check("Good news: tornadoes aren't in the cards.", facts("Tornadoes aren't expected."))).toBeNull();
    expect(check("Damaging winds aren't expected, just 15 percent.", facts("Damaging winds, up to 15 percent."))).toMatch(/says no/);
  });

  it("rejects hype, hail sizes and advice that the facts don't give", () => {
    expect(check("A tornado outbreak is possible, 10 percent.", torn)).toMatch(/outbreak/);
    expect(check("Baseball-size hail, up to 2 inches!", facts(`And large hail, up to 2".`))).toMatch(/Baseball/i);
    expect(check("Take cover: tornado odds hit 10 percent.", torn)).toMatch(/Take cover/i);
    expect(check("Like and subscribe, tornadoes at 10 percent.", torn)).toMatch(/off-limits/);
  });

  it("rejects lines that run past their word limit", () => {
    expect(check("Tornadoes, tornadoes, tornadoes, the tornado threat peaks right around 10 percent today so watch out.", facts(torn.scene, "", 8))).toMatch(/too long/);
  });
});

describe("digits", () => {
  it("writes spelled-out numbers as digits, but leaves 'one' alone", () => {
    expect(digits("Thirty-one large wildfires, five percent, and this one is big.")).toBe("31 large wildfires, 5 percent, and this one is big.");
    expect(digits("twenty five and twelve")).toBe("25 and 12");
    expect(digits("The Three Queens Fire is 3 weeks old.", "The Three Queens Fire in Washington.")).toBe("The Three Queens Fire is 3 weeks old.");
  });
});

describe("wordBudgets", () => {
  it("fits each line to its slot, the last before the end card, never under the plain line", () => {
    const cues: Cue[] = [
      { at: 0.4, text: "Here's your severe weather outlook for Monday, October 19." },
      { at: 4, text: "Short." },
      { at: 20.6, text: "x" },
    ];
    expect(wordBudgets(cues, 33)).toEqual([9, 44, 15]);
  });
});

describe("background", () => {
  it("gives the outlook's whole summary and a storm's name and forecast trend", () => {
    expect(background({ template: "outlook.html", data: { outlook: { summary: "Severe storms are likely across OK." } } })).toEqual([
      "The Storm Prediction Center's summary: Severe storms are likely across Oklahoma.",
    ]);
    const tropical = background({
      template: "tropical.html",
      data: { storm: { basin: "Atlantic", windMph: 60, forecast: [{ when: "Tue 8 PM", stage: "Hurricane", windMph: 80 }] } },
    });
    expect(tropical).toContain("Forecast: Tuesday 8 PM, Hurricane with 80 miles per hour winds.");
    expect(tropical).toContain("It is forecast to strengthen.");
    expect(background({ template: "tropical.html", data: { storm: { title: "Tropical Storm Trudy", forecast: [] } } })).toContain("The storm: Tropical Storm Trudy.");
  });

  it("puts the plain lines and limits in the prompt", () => {
    const p = buildPrompt({ template: "recap.html", data: {} }, [{ at: 0.4, text: "Here are the storm reports." }], [9], []);
    expect(p).toContain("1. [at most 9 words] Here are the storm reports.");
    expect(p).toContain("Write exactly 1 lines.");
  });
});

describe("parseLines", () => {
  it("reads the JSON out of the reply", () => {
    expect(parseLines('<think>hmm</think> Sure! {"lines": ["One  line.", "Two."]}', 2)).toEqual(["One line.", "Two."]);
    expect(() => parseLines('{"lines": ["One."]}', 2)).toThrow(/1 lines instead of 2/);
    expect(() => parseLines("no json", 1)).toThrow();
  });
});

/** A fake Ollama that streams each reply in small pieces, the way /api/chat does. */
function ollama(...replies: string[][]) {
  const enc = new TextEncoder();
  return vi.fn(async () => {
    const content = JSON.stringify({ lines: replies.shift() });
    const rows = content.match(/.{1,7}/gs)!.map((c) => `${JSON.stringify({ message: { role: "assistant", content: c }, done: false })}\n`);
    rows.push(`${JSON.stringify({ message: { content: "" }, done: true })}\n`);
    const body = rows.join("");
    return new Response(
      new ReadableStream({
        start(c) {
          for (let i = 0; i < body.length; i += 13) c.enqueue(enc.encode(body.slice(i, i + 13)));
          c.close();
        },
      }),
    );
  });
}

describe("livelyNarration", () => {
  const plain: Cue[] = [
    { at: 0.4, text: "Here's your severe weather outlook for Monday, October 19." },
    { at: 4, text: "The tornado threat peaks at 10 percent." },
    { at: 8, text: "Damaging winds, up to 15 percent." },
  ];
  const v = { template: "outlook.html", data: { outlook: { summary: "Storms are likely." } } };
  const quiet = () => {};

  it("uses the lines that pass and keeps the plain one where a rewrite fails", async () => {
    const fetch = ollama(["Monday, October 19: let's talk storms!", "Tornado odds top out at 10 percent.", "Winds gust to 90 miles per hour, up to 15 percent."]);
    const cues = await livelyNarration(v, plain, 20, { fetch, log: quiet });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cues.map((c) => c.text)).toEqual(["Monday, October 19: let's talk storms!", "Tornado odds top out at 10 percent.", "Damaging winds, up to 15 percent."]);
    expect(cues[1]).toEqual({ at: 4, text: "Tornado odds top out at 10 percent.", plain: "The tornado threat peaks at 10 percent." });
    expect(cues[2]!.plain).toBeUndefined();
  });

  it("asks again when the first draft has more than one bad line, and goes with the better draft", async () => {
    const fetch = ollama(
      ["Monday, October 19 brings a tornado outbreak!", "Tornado odds hit 30 percent.", "Damaging winds? Up to 15 percent."],
      ["Monday, October 19: here's the setup.", "Tornado odds top out at 10 percent.", "Watch the wind, up to 15 percent."],
    );
    const cues = await livelyNarration(v, plain, 20, { fetch, log: quiet });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(cues.map((c) => c.text)).toEqual(["Monday, October 19: here's the setup.", "Tornado odds top out at 10 percent.", "Watch the wind, up to 15 percent."]);
  });

  it("fills a line the better draft got wrong from the other draft", async () => {
    const fetch = ollama(
      ["Monday, October 19 brings a tornado outbreak!", "Tornado odds hit 30 percent.", "Damaging winds? Up to 15 percent."],
      ["Monday, October 19: here's the setup.", "Tornado odds top out at 10 percent.", "Winds gust to 90 miles per hour."],
    );
    const cues = await livelyNarration(v, plain, 20, { fetch, log: quiet });
    expect(cues.map((c) => c.text)).toEqual(["Monday, October 19: here's the setup.", "Tornado odds top out at 10 percent.", "Damaging winds? Up to 15 percent."]);
  });

  it("falls back to the plain script when Ollama isn't there", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:11434") });
    });
    expect(await livelyNarration(v, plain, 20, { fetch, log: quiet })).toEqual(plain);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("asks the Anthropic API instead when there's a key, for JSON in the script's shape", async () => {
    const lines = ["Monday, October 19: let's talk storms!", "Tornado odds top out at 10 percent.", "Damaging winds, up to 15 percent."];
    const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
      Response.json({ content: [{ type: "text", text: JSON.stringify({ lines }) }], stop_reason: "end_turn" }),
    );
    const cues = await livelyNarration(v, plain, 20, { fetch: fetch as unknown as typeof globalThis.fetch, anthropicKey: "sk-test", log: quiet });
    expect(cues.map((c) => c.text)).toEqual(lines);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-test");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: "claude-haiku-5-5", thinking: { type: "disabled" }, output_config: { format: { type: "json_schema" } } });
    expect(body.temperature).toBeUndefined();
  });

  it("reads the plain script when the Anthropic API turns the key away, without asking twice", async () => {
    const fetch = vi.fn(async () => new Response('{"error":{"message":"invalid x-api-key"}}', { status: 401 }));
    expect(await livelyNarration(v, plain, 20, { fetch, anthropicKey: "bad", log: quiet })).toEqual(plain);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("longestRewrite", () => {
  const cues: Cue[] = [
    { at: 0, text: "a", plain: "A" },
    { at: 3, text: "b" },
    { at: 6, text: "c", plain: "C" },
  ];

  it("is -1 when everything fits", () => {
    expect(longestRewrite(cues, [2, 2, 2], 10)).toBe(-1);
  });

  it("picks the rewrite that overruns its slot the most", () => {
    expect(longestRewrite(cues, [5, 2, 3], 10)).toBe(0);
    expect(longestRewrite(cues, [2, 2, 6], 10)).toBe(2);
  });

  it("is -1 when nothing is left to swap", () => {
    expect(longestRewrite([{ at: 0, text: "a" }], [12], 10)).toBe(-1);
  });
});
