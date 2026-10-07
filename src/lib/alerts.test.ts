import { describe, expect, it } from "vitest";
import { normalizeAlerts, type RawAlertFeature } from "./alerts";

const future = new Date(Date.now() + 3600_000).toISOString();
const past = new Date(Date.now() - 3600_000).toISOString();

const feature = (event: string, params: Record<string, string[]>, extra: Partial<RawAlertFeature["properties"]> = {}): RawAlertFeature => ({
  geometry: { type: "Polygon", coordinates: [[[-97, 35], [-96, 35], [-96, 36], [-97, 35]]] },
  properties: {
    id: `urn:${event}:${Math.random()}`,
    event,
    sent: past,
    effective: past,
    expires: future,
    severity: "Severe",
    parameters: params,
    ...extra,
  },
});

describe("alerts", () => {
  it("tags, ranks and drops expired alerts", () => {
    const out = normalizeAlerts([
      feature("Severe Thunderstorm Warning", { thunderstormDamageThreat: ["DESTRUCTIVE"], maxHailSize: ["2.75"] }),
      feature("Tornado Warning", {
        tornadoDetection: ["OBSERVED"],
        tornadoDamageThreat: ["CATASTROPHIC"],
        eventMotionDescription: ["2026-10-07T20:00:00-00:00...storm...225DEG...35KT...3521 9744"],
      }),
      feature("Tornado Warning", {}, { expires: past, ends: past }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.event).toBe("Tornado Warning");
    expect(out[0]!.tags).toEqual(["TORNADO EMERGENCY", "OBSERVED"]);
    expect(out[0]!.color).toBe("#ff0000");
    expect(out[0]!.motion?.headingDeg).toBe(45);
    expect(out[1]!.tags).toEqual(["DESTRUCTIVE"]);
    expect(out[1]!.hazards.maxHail).toBe("2.75");
  });
});
