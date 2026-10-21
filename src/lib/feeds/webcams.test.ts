import { afterEach, describe, expect, it } from "vitest";
import { toWebcam, webcamImage, webcamImageAt, WEBCAM_SOURCES } from "../webcams";
import { setUpstreamTransport } from "./upstream";
import { alertCaName, parseAlertCa, parseCaltrans, parseIowa, parseUsgsRiver, parseUsgsVolcano, parseWsdot, webcamsFeed } from "./webcams";

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

describe("parseIowa", () => {
  // A feature of Iowa DOT's "Traffic Cameras" layer (GeoJSON), as served in October 2026.
  const feature = (over: Record<string, unknown> = {}, coords: unknown[] = [-91.820917, 41.687152]) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: coords },
    properties: { Desc_: "IC - I-80 @ MM 229.2", ImageName: "IC - I-80 @ MM 229.2", ImageURL: "https://atmsqf.iowadot.gov/SNAPSHOTS/PUBLIC/Metro/ictv29hd.jpeg", ORG: "IADOT", ...over },
  });

  it("keeps Iowa DOT's cameras with a key that rebuilds the image address", () => {
    const rows = parseIowa([feature()]);
    expect(rows).toEqual([["iowa", "Metro/ictv29hd.jpeg", 41.6872, -91.8209, "IC - I-80 @ MM 229.2"]]);
    expect(webcamImage(toWebcam(rows[0]!))).toBe("https://atmsqf.iowadot.gov/SNAPSHOTS/PUBLIC/Metro/ictv29hd.jpeg");
  });

  it("leaves out other owners' cameras, images elsewhere, repeats and missing positions", () => {
    expect(parseIowa([feature({ ORG: "CITY" })])).toEqual([]);
    expect(parseIowa([feature({ ImageURL: "https://example.com/a.jpeg" })])).toEqual([]);
    expect(parseIowa([feature({ ImageURL: "https://atmsqf.iowadot.gov/SNAPSHOTS/PUBLIC/../x.jpeg" })])).toEqual([]);
    expect(parseIowa([feature(), feature()])).toHaveLength(1);
    expect(parseIowa([feature({}, [null, null])])).toEqual([]);
    expect(parseIowa(null)).toEqual([]);
  });

  it("leaves out cameras the layer's last refresh didn't reach (their pictures 404)", () => {
    const at = (UpdateDate: number, UpdateTime: number, ImageName: string) =>
      feature({ UpdateDate, UpdateTime, UTCoffset: -500, ImageName, ImageURL: `https://atmsqf.iowadot.gov/SNAPSHOTS/PUBLIC/RWIS/${ImageName}.jpg` });
    const rows = parseIowa([
      at(20261021, 64210, "live"),
      at(20261021, 64239, "same-batch"),
      at(20261021, 20000, "hours-behind"), // 02:00, 4h42m before the newest
      at(20261020, 72846, "yesterday"),
      feature({ ImageName: "unstamped", ImageURL: "https://atmsqf.iowadot.gov/SNAPSHOTS/PUBLIC/RWIS/unstamped.jpg" }),
    ]);
    expect(rows.map((r) => r[4])).toEqual(["live", "same-batch", "unstamped"]);
  });

  it("measures staleness against the newest camera, not the clock, and across midnight", () => {
    // Last refresh ran days ago: everything from that batch still shows.
    expect(parseIowa([feature({ UpdateDate: 20260101, UpdateTime: 64210, UTCoffset: -500 })])).toHaveLength(1);
    // 23:30 and 00:15 the next day are 45 minutes apart.
    const late = feature({ UpdateDate: 20261020, UpdateTime: 233000, UTCoffset: -500, ImageURL: "https://atmsqf.iowadot.gov/SNAPSHOTS/PUBLIC/Metro/a.jpg" });
    const early = feature({ UpdateDate: 20261021, UpdateTime: 1500, UTCoffset: -500, ImageURL: "https://atmsqf.iowadot.gov/SNAPSHOTS/PUBLIC/Metro/b.jpg" });
    expect(parseIowa([late, early])).toHaveLength(2);
  });
});

describe("parseWsdot", () => {
  // A feature of WSDOT's TravelInfoCamerasWeather layer (Esri JSON), as served in October 2026.
  const feature = (ImageURL: string, CameraTitle = "I-5 at Kalama River") => ({ attributes: { OBJECTID: 1, CameraTitle, ImageURL, CompassDirection: "S" }, geometry: { x: -122.84, y: 46.03 } });

  it("keeps WSDOT's own cameras with a key that rebuilds the image address", () => {
    const rows = parseWsdot([feature("https://images.wsdot.wa.gov/sw/005vc00320.jpg")]);
    expect(rows).toEqual([["wsdot", "sw/005vc00320.jpg", 46.03, -122.84, "I-5 at Kalama River"]]);
    expect(webcamImage(toWebcam(rows[0]!))).toBe("https://images.wsdot.wa.gov/sw/005vc00320.jpg");
  });

  it("leaves out the Oregon TripCheck cameras the layer also lists", () => {
    expect(parseWsdot([feature("https://www.tripcheck.com/RoadCams/cams/I-5%20Bridge%20SB%20North_pid4676.jpg")])).toEqual([]);
    expect(parseWsdot([{ attributes: { ImageURL: "https://images.wsdot.wa.gov/sw/a.jpg" }, geometry: {} }])).toEqual([]);
  });
});

describe("cameras waiting for permission", () => {
  afterEach(() => setUpstreamTransport(async () => ({})));

  it("aren't fetched or listed until their owner allows it", async () => {
    expect(WEBCAM_SOURCES.iowa.approved).toBe(false);
    expect(WEBCAM_SOURCES.wsdot.approved).toBe(false);
    const asked: string[] = [];
    setUpstreamTransport(async (url) => {
      asked.push(url);
      return {};
    });
    const res = await webcamsFeed.load(new URLSearchParams());
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.filter((u) => /iowadot|wsdot/.test(u))).toEqual([]);
    expect(res.cams.filter(([source]) => source === "iowa" || source === "wsdot")).toEqual([]);
  });

  it("never reach the live stream without being allowed in the app first", () => {
    for (const info of Object.values(WEBCAM_SOURCES)) if (info.onStream) expect(info.approved).toBe(true);
    expect(WEBCAM_SOURCES.iowa.onStream).toBe(false);
    expect(WEBCAM_SOURCES.wsdot.onStream).toBe(false);
  });
});
