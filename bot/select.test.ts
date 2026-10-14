import { describe, expect, it } from "vitest";
import { composePost, localTime, parseVtec, placeText, selectCandidates, weightedLength, type BotFeature } from "./select";

const NOW = Date.parse("2026-05-21T21:45:00Z");

function feature(over: Partial<BotFeature["properties"]> & { vtec: string; params?: Record<string, string[]>; ugc?: string[] }): BotFeature {
  const { vtec, params, ugc, ...props } = over;
  return {
    geometry: { type: "Polygon", coordinates: [[[-97.6, 35.2], [-97.3, 35.2], [-97.3, 35.4], [-97.6, 35.4], [-97.6, 35.2]]] },
    properties: {
      id: `urn:${vtec}`,
      event: "Tornado Warning",
      severity: "Extreme",
      sent: "2026-05-21T16:40:00-05:00",
      effective: "2026-05-21T16:40:00-05:00",
      expires: "2026-05-21T17:15:00-05:00",
      ends: "2026-05-21T17:15:00-05:00",
      areaDesc: "Cleveland, OK; McClain, OK",
      messageType: "Alert",
      description: "",
      parameters: { VTEC: [vtec], tornadoDetection: ["RADAR INDICATED"], maxHailSize: ["1.00"], ...params },
      geocode: { UGC: ugc ?? ["OKC027", "OKC087"] },
      ...props,
    },
  } as BotFeature;
}

const TOR = "/O.NEW.KOUN.TO.W.0042.260521T2140Z-260521T2215Z/";

describe("VTEC", () => {
  it("parses the parts, taking the year from the end time", () => {
    expect(parseVtec(TOR)).toEqual({ action: "NEW", office: "KOUN", phenomena: "TO", significance: "W", etn: "0042", year: "26" });
    expect(parseVtec("/O.CON.KOUN.TO.A.0123.000000T0000Z-260522T0300Z/")?.year).toBe("26");
    expect(parseVtec("nonsense")).toBeNull();
  });
});

describe("selection", () => {
  it("posts a new tornado warning once, and again only when upgraded", () => {
    const [c] = selectCandidates([feature({ vtec: TOR })], {}, NOW);
    expect(c).toMatchObject({ eventKey: "KOUN.TO.W.0042.26", level: "normal", priority: 2, upgrade: false });
    expect(selectCandidates([feature({ vtec: TOR })], { "KOUN.TO.W.0042.26": "normal" }, NOW)).toHaveLength(0);
    const emergency = feature({ vtec: TOR.replace("NEW", "CON"), description: "...TORNADO EMERGENCY FOR MOORE..." });
    const [up] = selectCandidates([emergency], { "KOUN.TO.W.0042.26": "normal" }, NOW);
    expect(up).toMatchObject({ level: "emergency", priority: 1, upgrade: true });
  });

  it("skips follow-up statements, cancellations and ordinary severe storms", () => {
    expect(selectCandidates([feature({ vtec: TOR.replace("NEW", "CON") })], {}, NOW)).toHaveLength(0);
    expect(selectCandidates([feature({ vtec: TOR.replace("NEW", "CAN") })], {}, NOW)).toHaveLength(0);
    const svr = feature({ vtec: "/O.NEW.KOUN.SV.W.0100.260521T2140Z-260521T2215Z/", event: "Severe Thunderstorm Warning", params: { maxHailSize: ["1.00"], maxWindGust: ["60"] } });
    expect(selectCandidates([svr], {}, NOW)).toHaveLength(0);
    const big = feature({ vtec: "/O.NEW.KOUN.SV.W.0101.260521T2140Z-260521T2215Z/", event: "Severe Thunderstorm Warning", params: { maxHailSize: ["2.75"], maxWindGust: ["70"] } });
    expect(selectCandidates([big], {}, NOW)[0]).toMatchObject({ priority: 3 });
  });

  it("merges a watch's county alerts from several offices into one post", () => {
    const watch = (office: string, ugc: string[]) =>
      feature({ vtec: `/O.NEW.${office}.TO.A.0123.260521T2100Z-260522T0300Z/`, event: "Tornado Watch", ugc, areaDesc: "Somewhere, XX", sent: "2026-05-21T16:30:00-05:00", expires: "2026-05-21T22:00:00-05:00", ends: "2026-05-21T22:00:00-05:00" });
    const cands = selectCandidates([watch("KOUN", ["OKC027"]), watch("KTSA", ["OKC143"]), watch("KFWD", ["TXC485"])], {}, NOW);
    expect(cands).toHaveLength(1);
    expect(cands[0]!.watchStates).toEqual(["OK", "TX"]);
    expect(composePost(cands[0]!)).toMatch(/^Tornado Watch 123 for parts of OK and TX until 10:00 PM CDT\./);
  });
});

describe("wording", () => {
  it("writes a complete, plain post within 280 characters", () => {
    const [c] = selectCandidates([feature({ vtec: TOR, params: { tornadoDetection: ["OBSERVED"], maxHailSize: ["1.75"] } })], {}, NOW);
    const text = composePost(c!);
    expect(text).toBe(
      [
        "TORNADO WARNING for Cleveland and McClain, OK until 5:15 PM CDT.",
        "Tornado observed. Hail up to 1.75 in.",
        "Take shelter now if you are in the warned area.",
        "#okwx",
        "https://storm-central-pi.vercel.app/?mode=severe&lat=35.280&lon=-97.480",
      ].join("\n"),
    );
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("trims long county lists to fit", () => {
    const many = Array.from({ length: 30 }, (_, i) => `County Number ${i}, TX`).join("; ");
    const [c] = selectCandidates([feature({ vtec: TOR, areaDesc: many, ugc: ["TXC001"] })], {}, NOW);
    const text = composePost(c!);
    expect(weightedLength(text)).toBeLessThanOrEqual(280);
    expect(text).toMatch(/and \d+ more until/);
  });

  it("names places and time zones", () => {
    expect(placeText("Cleveland, OK; Love, OK; Cooke, TX", 6)).toBe("Cleveland and Love, OK; Cooke, TX");
    expect(placeText("A, OK; B, OK; C, OK", 2)).toBe("A and B, OK and 1 more");
    expect(localTime("2026-05-21T17:15:00-05:00")).toBe("5:15 PM CDT");
    expect(localTime("2026-01-10T09:05:00-05:00")).toBe("9:05 AM EST");
    expect(localTime("2026-07-01T15:00:00-07:00", ["AZ"])).toBe("3:00 PM MST");
  });
});
