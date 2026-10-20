import { describe, expect, it } from "vitest";
import { toWebcam, webcamImage, webcamImageAt, WEBCAM_SOURCES } from "../webcams";
import { alertCaName, parseAlertCa, parseCaltrans, parseUsgsRiver, parseUsgsVolcano } from "./webcams";

// Shapes copied from the live responses (October 2026).
const NOW = Date.parse("2026-10-20T00:10:00Z");

describe("parseCaltrans", () => {
  const cam = (over: Record<string, unknown> = {}) => ({
    cctv: {
      inService: "true",
      location: { locationName: "I-110 : (196) Avenue 26 Off Ramp", nearbyPlace: "Cypress Park", latitude: "34.0837", longitude: "-118.2215" },
      imageData: { static: { currentImageURL: "https://cwwp2.dot.ca.gov/data/d7/cctv/image/i110196avenue26offramp/i110196avenue26offramp.jpg" } },
      ...over,
    },
  });

  it("keeps in-service cameras, with a tidy name and a key that rebuilds the image address", () => {
    const rows = parseCaltrans({ data: [cam()] });
    expect(rows).toEqual([["caltrans", "7/i110196avenue26offramp", 34.0837, -118.2215, "I-110 · Avenue 26 Off Ramp"]]);
    expect(webcamImage(toWebcam(rows[0]!))).toBe("https://cwwp2.dot.ca.gov/data/d7/cctv/image/i110196avenue26offramp/i110196avenue26offramp.jpg");
  });

  it("skips cameras out of service, without a position, or with an image elsewhere", () => {
    expect(parseCaltrans({ data: [cam({ inService: "false" })] })).toEqual([]);
    expect(parseCaltrans({ data: [cam({ location: { locationName: "x", latitude: "", longitude: "" } })] })).toEqual([]);
    expect(parseCaltrans({ data: [cam({ imageData: { static: { currentImageURL: "https://example.com/a.jpg" } } })] })).toEqual([]);
    expect(parseCaltrans(null)).toEqual([]);
  });
});

describe("parseAlertCa", () => {
  const feature = (id: string, coords: unknown[], ageSec = 60, name = "") => ({
    geometry: { type: "Point", coordinates: coords },
    properties: { id, name, last_frame_ts: NOW / 1000 - ageSec },
  });

  it("keeps cameras with a position that sent a picture in the last two hours", () => {
    const rows = parseAlertCa({ features: [feature("Axis-AlabamaHills1", [-118.1, 36.6, 1500])] }, NOW);
    expect(rows).toEqual([["alertca", "Axis-AlabamaHills1", 36.6, -118.1, "Alabama Hills 1"]]);
  });

  it("drops null positions (most of the list) and offline cameras", () => {
    expect(parseAlertCa({ features: [feature("AXIS-Napili", [null, null, null])] }, NOW)).toEqual([]);
    expect(parseAlertCa({ features: [feature("Axis-Old", [-118, 36], 3 * 3600)] }, NOW)).toEqual([]);
  });

  it("names cameras from their id when they have no name", () => {
    expect(alertCaName("Axis-BaldyMesa2")).toBe("Baldy Mesa 2");
    expect(alertCaName("AXIS-BCPOSLongmont")).toBe("BCPOSLongmont");
    expect(alertCaName("Axis-Mt_Wilson-1")).toBe("Mt Wilson 1");
  });
});

describe("parseUsgsRiver", () => {
  const cam = (over: Record<string, unknown> = {}) => ({
    camId: "IL_Lick_Creek_near_Woodside",
    camName: "Lick Creek near Woodside",
    stateAbrv: "IL",
    lat: "39.71553889",
    lng: "-89.7024444",
    hideCam: false,
    newestImageDT: "2026-10-20T00:00:02.000Z",
    smallDir: "https://usgs-nims-images.s3.amazonaws.com/720/IL_Lick_Creek_near_Woodside/",
    ...over,
  });

  it("keeps recent, visible cameras with the state in the name", () => {
    const rows = parseUsgsRiver([cam()], NOW);
    expect(rows).toEqual([["usgs-river", "IL_Lick_Creek_near_Woodside", 39.7155, -89.7024, "Lick Creek near Woodside, IL"]]);
    expect(webcamImage(toWebcam(rows[0]!))).toBe("https://usgs-nims-images.s3.amazonaws.com/720/IL_Lick_Creek_near_Woodside/IL_Lick_Creek_near_Woodside_newest.jpg");
  });

  it("title-cases names written in capitals", () => {
    expect(parseUsgsRiver([cam({ camName: "SWAN CREEK AT SWAN CREEK", stateAbrv: "MD" })], NOW)[0]![4]).toBe("Swan Creek At Swan Creek, MD");
  });

  it("skips hidden, stale and differently stored cameras", () => {
    expect(parseUsgsRiver([cam({ hideCam: true })], NOW)).toEqual([]);
    expect(parseUsgsRiver([cam({ newestImageDT: "2026-10-19T12:00:00Z" })], NOW)).toEqual([]);
    expect(parseUsgsRiver([cam({ smallDir: "https://elsewhere.example/720/x/" })], NOW)).toEqual([]);
    expect(parseUsgsRiver({ not: "an array" }, NOW)).toEqual([]);
  });
});

describe("parseUsgsVolcano", () => {
  const cam = (over: Record<string, unknown> = {}) => ({
    webcamCode: "augustine-N",
    webcamName: "Augustine - N",
    vName: "Augustine",
    latitude: 59.36,
    longitude: -153.43,
    faaInd: "N",
    currentMediumImageUrl: "https://volcview.wr.usgs.gov/ashcam-api/images/webcams/augustine-N/current-medium.jpg",
    newestImage: { imageTimestamp: NOW / 1000 - 600 },
    ...over,
  });

  it("keeps USGS cameras with a recent picture", () => {
    expect(parseUsgsVolcano({ webcams: [cam()] }, NOW)).toEqual([["usgs-volcano", "augustine-N", 59.36, -153.43, "Augustine - N"]]);
    expect(parseUsgsVolcano({ webcams: [cam({ webcamName: "North rim", vName: "Kilauea" })] }, NOW)[0]![4]).toBe("North rim (Kilauea)");
    expect(parseUsgsVolcano({ webcams: [cam({ webcamName: "CVO St. Helens (JRO)", vName: "Mount St. Helens" })] }, NOW)[0]![4]).toBe("CVO St. Helens (JRO)");
  });

  it("leaves out FAA cameras, cameras with no picture, stale ones and 0,0 positions", () => {
    expect(parseUsgsVolcano({ webcams: [cam({ faaInd: "Y" })] }, NOW)).toEqual([]);
    expect(parseUsgsVolcano({ webcams: [cam({ currentMediumImageUrl: null, newestImage: [] })] }, NOW)).toEqual([]);
    expect(parseUsgsVolcano({ webcams: [cam({ newestImage: { imageTimestamp: NOW / 1000 - 7 * 3600 } })] }, NOW)).toEqual([]);
    expect(parseUsgsVolcano({ webcams: [cam({ latitude: 0, longitude: 0 })] }, NOW)).toEqual([]);
  });
});

describe("webcamImageAt", () => {
  it("changes its cache-busting step only as often as the source takes new pictures", () => {
    const cam = { source: "usgs-river" as const, key: "X" };
    const step = WEBCAM_SOURCES["usgs-river"].refreshMin * 60_000;
    const t0 = Math.floor(NOW / step) * step;
    expect(webcamImageAt(cam, t0)).toBe(webcamImageAt(cam, t0 + step - 1));
    expect(webcamImageAt(cam, t0)).not.toBe(webcamImageAt(cam, t0 + step));
  });
});
