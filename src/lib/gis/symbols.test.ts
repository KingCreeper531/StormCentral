import { describe, expect, it } from "vitest";
import { parseGis } from "./index";
import { clearBlackBackground, iconFrame, iconImageId, iconImages } from "./render";
import { reportAge, symbolsUsed, withoutContacts } from "./symbols";

// Shaped like Spotter Network's gr-no.txt (names and numbers made up).
const SN = `Refresh: 1
Threshold: 999
Title: Spotter Network Positions - All - No Names
Font: 1, 11, 0, "Courier New"
IconFile: 1, 22, 22, 11, 11, "http://www.spotternetwork.org/icon/spotternet.png"
IconFile: 2, 15, 25, 8, 25, "http://www.spotternetwork.org/icon/arrows.png"
IconFile: 6, 22, 22, 11, 11, "http://www.spotternetwork.org/icon/spotternet_new.png"
Object: 35.2226,-97.4395
Icon: 0,0,000,6,2,"Jane Doe\\n2026-10-20 21:28:00 UTC\\nHeading E at 25 mph\\nPhone: 405-555-0101\\nEmail: jane@example.com\\nTwitter: https://twitter.com/janedoe"
Icon: 0,0,090,2,15,
End:
Object: 35.80,-97.10
Icon: 0,0,000,6,6,"John Roe\\n2026-10-20 20:47:00 UTC\\nSTATIONARY\\nNote: call 405-555-0102 or john@example.com"
End:
Object: 34.90,-98.20
Icon: 0,0,000,6,10,"Old Timer\\n2026-10-20 18:31:00 UTC\\nSTATIONARY"
End:
Object: 34.50,-98.50
Icon: 0,0,000,6,9,"No Time Given"
End:
`;
const NOW = Date.parse("2026-10-20T21:31:00Z");

describe("Spotter Network symbols", () => {
  const d = parseGis(SN, "placefile", "https://www.spotternetwork.org/feeds/gr-no.txt", NOW);
  const icons = d.features.flatMap((f) => (f.properties.kind === "icon" ? [f.properties] : []));

  it("marks spotters by how long ago they reported, and moving ones with a heading arrow", () => {
    expect(icons.map((p) => p.icon)).toEqual(["sym:spotter-live", "sym:heading", "sym:spotter-recent", "sym:spotter-old", "sym:spotter-old"]);
    expect(icons[1]!.rotate).toBe(90);
    expect(symbolsUsed(d)).toEqual(["spotter-live", "spotter-recent", "spotter-old", "heading"]);
  });

  it("reads the report time from the hover text", () => {
    expect(reportAge("x\n2026-10-20 21:20:06 UTC\ny", NOW)).toBeCloseTo(10.9, 1);
    expect(reportAge("no time", NOW)).toBeNull();
  });

  it("leaves other feeds' icons alone", () => {
    const other = parseGis('IconFile: 1, 22, 22, 11, 11, "https://example.com/icons.png"\nIcon: 35, -97, 0, 1, 2, "x"', "placefile", undefined, NOW);
    expect(other.features[0]!.properties).toMatchObject({ icon: "1-2" });
    expect(symbolsUsed(other)).toEqual([]);
  });
});

describe("contact details", () => {
  it("never reach the hover text", () => {
    const d = parseGis(SN, "placefile", undefined, NOW);
    const hovers = d.features.map((f) => f.properties.hover ?? "").join("\n");
    expect(hovers).not.toMatch(/555|@example|Phone|Email/);
    expect(hovers).toContain("Twitter: https://twitter.com/janedoe");
    expect(hovers).toContain("Note: call or");
  });

  it("keep times, sizes and frequencies", () => {
    const kept = "KEMX [H0] 21:06 Z\nPOH: 50 POSH: 40 MaxSize: 1.0\nRadio: 462.6750, 146.520, 27.185\n2026-10-20 21:28:00 UTC";
    expect(withoutContacts(kept)).toBe(kept);
    expect(withoutContacts("Phone: 9189985664")).toBeUndefined();
    expect(withoutContacts("(405) 555-0103")).toBeUndefined();
  });
});

describe("icon images", () => {
  it("put the hotspot on the point", () => {
    // Spotter Network's arrow: 15×25 with its hotspot at the bottom middle, so it sticks out from the point.
    expect(iconFrame(15, 25, 8, 25, 0, 0)).toEqual({ width: 16, height: 50, x: 0, y: 0 });
    // A centred icon needs no padding.
    expect(iconFrame(22, 22, 11, 11, 0, 0)).toEqual({ width: 22, height: 22, x: 0, y: 0 });
    // Shifted 10 px right: the image widens so the point stays in the middle.
    expect(iconFrame(22, 22, 11, 11, 10, 0)).toEqual({ width: 42, height: 22, x: 20, y: 0 });
  });

  it("are one per sheet cell and offset, and symbols are shared", () => {
    expect(iconImageId("a", { icon: "6-2", dx: 0, dy: 0 })).toBe("gis-a-6-2");
    expect(iconImageId("a", { icon: "6-2", dx: 10.4, dy: -500 })).toBe("gis-a-6-2@10,-128");
    expect(iconImageId("a", { icon: "sym:heading", dx: 5, dy: 5 })).toBe("gis-sym:heading");
    const d = parseGis(SN, "placefile", undefined, NOW);
    expect(iconImages("a", d).map((i) => i.id)).toEqual(["gis-sym:spotter-live", "gis-sym:heading", "gis-sym:spotter-recent", "gis-sym:spotter-old"]);
  });

  it("lose the black around icons on sheets without transparency", () => {
    const opaque = new Uint8ClampedArray([0, 0, 0, 255, 255, 0, 0, 255, 24, 0, 0, 255]);
    expect(clearBlackBackground(opaque)).toBe(true);
    // Black goes, red stays, and a near-black edge pixel turns half see-through (still dark).
    expect([...opaque]).toEqual([0, 0, 0, 0, 255, 0, 0, 255, 48, 0, 0, 128]);
    const seeThrough = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255]);
    expect(clearBlackBackground(seeThrough)).toBe(false);
    expect(seeThrough[7]).toBe(255);
  });
});
