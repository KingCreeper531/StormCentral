import { describe, expect, it } from "vitest";
import { cleanLook, DEFAULT_LOOK, isDefault, LOWER_KEYS, TICKER_KEYS, tickerSeconds, withAlpha } from "./look";

describe("broadcast look", () => {
  it("keeps what's valid and drops the rest", () => {
    const look = cleanLook({
      lowerTitle: "  Severe weather coverage ",
      lowerBg: "#123ABC",
      lowerColor: "red",
      lowerOpacity: 3,
      lowerSize: "xl",
      tickerSpeed: "fast",
      tickerLabelColor: null,
      tickerMessage: "x".repeat(500),
      tickerCodes: "no",
    });
    expect(look.lowerTitle).toBe("Severe weather coverage ");
    expect(look.lowerBg).toBe("#123abc");
    expect(look.lowerColor).toBeNull();
    expect(look.lowerOpacity).toBe(1);
    expect(look.lowerSize).toBe("m");
    expect(look.tickerSpeed).toBe("fast");
    expect(look.tickerMessage).toHaveLength(140);
    expect(look.tickerCodes).toBe(true);
    expect(cleanLook(null)).toEqual(DEFAULT_LOOK);
  });

  it("applies a partial change on top of the current look", () => {
    const now = cleanLook({ tickerBg: "#222222" });
    expect(cleanLook({ tickerLarge: true }, now)).toMatchObject({ tickerBg: "#222222", tickerLarge: true });
    expect(cleanLook({ lowerColor: null }, cleanLook({ lowerColor: "#00ff00" })).lowerColor).toBeNull();
  });

  it("times the ticker by its length and speed", () => {
    expect(tickerSeconds(100, "normal")).toBe(30);
    expect(tickerSeconds(900, "normal")).toBe(100);
    expect(tickerSeconds(900, "slow")).toBe(160);
    expect(tickerSeconds(900, "fast")).toBe(60);
  });

  it("knows when a section is back to the default", () => {
    expect(isDefault(DEFAULT_LOOK, LOWER_KEYS)).toBe(true);
    const changed = cleanLook({ tickerSpeed: "slow" });
    expect(isDefault(changed, LOWER_KEYS)).toBe(true);
    expect(isDefault(changed, TICKER_KEYS)).toBe(false);
    expect(withAlpha("#0e1424", 0.5)).toBe("rgba(14, 20, 36, 0.5)");
  });
});
