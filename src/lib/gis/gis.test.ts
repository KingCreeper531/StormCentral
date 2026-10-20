import { describe, expect, it } from "vitest";
import { detectFormat, layerName, parseGis, readLayer } from "./index";
import { kmlColor, plainText } from "./kml";
import { splitArgs, thresholdToMinzoom } from "./placefile";

// In the style of Spotter Network's feed and of hand-made threat-box placefiles.
const PLACEFILE = `; chasers and a threat box
Title: Chasers (test)
Refresh: 2
Threshold: 999
IconFile: 1, 22, 22, 11, 11, "icons/spotter.png"
Font: 1, 11, 1, "Courier New"
Color: 255 255 0
Object: 35.2226, -97.4395
  Threshold: 999
  Icon: 0, 0, 090, 1, 3, "Jane Doe\\nUpdated 18:02Z\\nHeading: E, 30 mph"
  Text: 15, 10, 1, "Jane"
End:
// a threat box with a translucent fill colour on its first vertex
Color: 255 0 0 128
Line: 3, 0, "Tornado threat, east of town"
35.0, -97.5
35.0, -97.0
35.5, -97.0
End:
Polygon: "Hail swath"
35.0, -98.0, 0, 255, 0, 64
35.0, -97.8
35.2, -97.8
End:
Triangles:
36.0, -96.0, 0, 0, 255
36.0, -95.0
37.0, -95.5
End:
Place: 35.47, -97.52, Oklahoma City
Text: 36.15, -95.99, 1, "Tulsa, OK", "Tulsa hover"
Image: 35, -98, 36, -97, "x.png"
35.0, -98.0
End:
`;

describe("placefiles", () => {
  const d = parseGis(PLACEFILE, "placefile", "https://feeds.example.com/gr/chasers.txt");

  it("reads the header", () => {
    expect(d.title).toBe("Chasers (test)");
    expect(d.refreshSec).toBe(120);
    expect(d.iconFiles).toEqual([{ n: 1, w: 22, h: 22, hotX: 11, hotY: 11, url: "https://feeds.example.com/gr/icons/spotter.png" }]);
  });

  it("places an object's icon and text around its point, with hover text", () => {
    const icon = d.features.find((f) => f.properties.kind === "icon")!;
    expect(icon.geometry).toEqual({ type: "Point", coordinates: [-97.4395, 35.2226] });
    expect(icon.properties).toMatchObject({ icon: "1-3", rotate: 90, dx: 0, dy: -0, hover: "Jane Doe\nUpdated 18:02Z\nHeading: E, 30 mph" });
    const label = d.features.find((f) => f.properties.kind === "text" && f.properties.text === "Jane")!;
    expect(label.properties).toMatchObject({ dx: 15, dy: -10, size: 11, color: "#ffff00" });
  });

  it("draws lines, polygons and triangles in their colours", () => {
    const line = d.features.find((f) => f.properties.kind === "line")!;
    expect(line.geometry).toEqual({ type: "LineString", coordinates: [[-97.5, 35], [-97, 35], [-97, 35.5]] });
    expect(line.properties).toMatchObject({ color: "#ff0000", opacity: 128 / 255, width: 3, hover: "Tornado threat, east of town" });
    const fills = d.features.filter((f) => f.properties.kind === "fill");
    expect(fills).toHaveLength(2);
    expect(fills[0]!.properties).toMatchObject({ color: "#00ff00", opacity: 64 / 255, hover: "Hail swath" });
    expect((fills[0]!.geometry as { coordinates: number[][][] }).coordinates[0]).toHaveLength(4); // closed ring
    expect(fills[1]!.properties).toMatchObject({ color: "#0000ff", opacity: 1 });
  });

  it("reads places and free text, and skips images", () => {
    const texts = d.features.filter((f) => f.properties.kind === "text").map((f) => (f.properties.kind === "text" ? f.properties.text : ""));
    expect(texts).toEqual(["Jane", "Oklahoma City", "Tulsa, OK"]);
    // icon, its label, the line, two fills, the place and the text: nothing from the Image block.
    expect(d.features).toHaveLength(7);
  });

  it("splits quoted arguments and turns thresholds into zooms", () => {
    expect(splitArgs('1, 2, "a, b", c')).toEqual(["1", "2", "a, b", "c"]);
    expect(thresholdToMinzoom(999)).toBe(0);
    expect(thresholdToMinzoom(null)).toBe(0);
    expect(thresholdToMinzoom(100)).toBeCloseTo(7.55, 1);
    expect(thresholdToMinzoom(25)).toBeGreaterThan(thresholdToMinzoom(100));
  });

  it("keeps a Threshold inside an Object to that object, and joins split hover text (IEM's storm attributes)", () => {
    const iem = parseGis(
      [
        "Refresh: 3",
        "Threshold: 45",
        'IconFile: 1, 32, 32, 16, 16, "https://mesonet.agron.iastate.edu/request/grx/storm_attribute.png"',
        "Object: 32.2584,-109.8866",
        "Threshold: 999",
        'Icon: 0,0,0,1,8,"KEMX [H0] 21:06 Z\\n" "Drct: 256 Speed: 17 kts\\nTVS: NONE MESO: 2\\n"',
        "END:",
        'Line: 1, 0, "Cell [H0]"',
        "32.2584, -109.8866",
        "32.3163, -109.6122",
        "END:",
      ].join("\n"),
      "placefile",
    );
    const icon = iem.features.find((f) => f.properties.kind === "icon")!;
    const track = iem.features.find((f) => f.properties.kind === "line")!;
    expect(icon.properties.minzoom).toBe(0);
    expect(track.properties.minzoom).toBeCloseTo(thresholdToMinzoom(45), 5);
    expect(icon.properties.hover).toBe("KEMX [H0] 21:06 Z\nDrct: 256 Speed: 17 kts\nTVS: NONE MESO: 2");
  });

  it("survives junk", () => {
    expect(parseGis("Line: 2\nnot a coordinate\n99, 999\nEnd:\nObject: x, y\nIcon: 0,0,0,1,1\nEnd:", "placefile").features).toEqual([]);
  });
});

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Chase routes</name>
<Style id="red"><LineStyle><color>ff0000ff</color><width>4</width></LineStyle><PolyStyle><color>7f00ff00</color></PolyStyle></Style>
<StyleMap id="redmap"><Pair><key>normal</key><styleUrl>#red</styleUrl></Pair><Pair><key>highlight</key><styleUrl>#red</styleUrl></Pair></StyleMap>
<Placemark><name>Target</name><description><![CDATA[<b>Meet</b> here<br>at 3 PM &amp; wait]]></description><Point><coordinates>-97.5,35.2,0</coordinates></Point></Placemark>
<Placemark><name>Route</name><styleUrl>#redmap</styleUrl><LineString><coordinates>-97.5,35.2 -97.0,35.6</coordinates></LineString></Placemark>
<Placemark><name>Area</name><styleUrl>#red</styleUrl><MultiGeometry><Polygon><outerBoundaryIs><LinearRing><coordinates>-98,35 -97,35 -97,36 -98,35</coordinates></LinearRing></outerBoundaryIs>
<innerBoundaryIs><LinearRing><coordinates>-97.8,35.2 -97.6,35.2 -97.6,35.4 -97.8,35.2</coordinates></LinearRing></innerBoundaryIs></Polygon></MultiGeometry></Placemark>
</Document></kml>`;

describe("KML", () => {
  const d = parseGis(KML, "kml");

  it("reads placemarks with their styles", () => {
    expect(d.title).toBe("Chase routes");
    const point = d.features.find((f) => f.properties.kind === "point")!;
    expect(point.geometry).toEqual({ type: "Point", coordinates: [-97.5, 35.2] });
    expect(point.properties.hover).toBe("Target\nMeet here\nat 3 PM & wait");
    const route = d.features.find((f) => f.properties.kind === "line" && f.properties.hover === "Route")!;
    expect(route.properties).toMatchObject({ color: "#ff0000", width: 4, opacity: 1 });
    const fill = d.features.find((f) => f.properties.kind === "fill")!;
    expect(fill.properties).toMatchObject({ color: "#00ff00", opacity: 127 / 255 });
    expect((fill.geometry as { coordinates: unknown[] }).coordinates).toHaveLength(2); // outer ring + hole
  });

  it("decodes colours and text", () => {
    expect(kmlColor("ff0000ff")).toEqual({ color: "#ff0000", opacity: 1 });
    expect(kmlColor("nope")).toBeNull();
    expect(plainText("<![CDATA[a<br/>b &lt;c&gt;]]>")).toBe("a\nb <c>");
  });
});

describe("GeoJSON", () => {
  it("uses simplestyle properties and names", () => {
    const d = parseGis(
      JSON.stringify({
        type: "FeatureCollection",
        name: "Roads",
        features: [
          { type: "Feature", properties: { name: "I-35", stroke: "#3366ff", "stroke-width": 3 }, geometry: { type: "LineString", coordinates: [[-97.5, 35], [-97.4, 36]] } },
          { type: "Feature", properties: { title: "Shelter", "marker-color": "#00aa00" }, geometry: { type: "Point", coordinates: [-97.4, 35.3] } },
          { type: "Feature", properties: { fill: "#ff0000", "fill-opacity": 0.5 }, geometry: { type: "Polygon", coordinates: [[[-98, 35], [-97, 35], [-97, 36], [-98, 35]]] } },
        ],
      }),
      "geojson",
    );
    expect(d.title).toBe("Roads");
    expect(d.features.find((f) => f.properties.kind === "line" && f.geometry.type === "LineString")!.properties).toMatchObject({ color: "#3366ff", width: 3, hover: "I-35" });
    expect(d.features.find((f) => f.properties.kind === "point")!.properties).toMatchObject({ color: "#00aa00", hover: "Shelter" });
    expect(d.features.find((f) => f.properties.kind === "text")!.properties).toMatchObject({ text: "Shelter" });
    expect(d.features.find((f) => f.properties.kind === "fill")!.properties).toMatchObject({ color: "#ff0000", opacity: 0.5 });
  });

  it("takes a bare geometry, and rejects what isn't JSON", () => {
    expect(parseGis('{"type":"Point","coordinates":[-97,35]}', "geojson").features).toHaveLength(1);
    expect(() => parseGis("not json", "geojson")).toThrow();
  });
});

describe("format detection", () => {
  it("goes by content first", () => {
    expect(detectFormat('{"type":"FeatureCollection","features":[]}')).toBe("geojson");
    expect(detectFormat(KML)).toBe("kml");
    expect(detectFormat(PLACEFILE)).toBe("placefile");
    expect(detectFormat("Title: x", "thing.kml")).toBe("kml");
  });

  it("names layers from their title or link", () => {
    expect(layerName({ title: "Mine", refreshSec: null, iconFiles: [], features: [] }, "x")).toBe("Mine");
    expect(layerName(null, "https://example.com/feeds/gr%20chasers.txt")).toBe("gr chasers.txt");
  });
});

describe("readLayer", () => {
  it("accepts layers, even a live placefile with nothing in it right now", () => {
    expect(readLayer(PLACEFILE).format).toBe("placefile");
    expect(readLayer("RefreshSeconds: 60\nThreshold: 999\nTitle: NWS warnings\n").data.title).toBe("NWS warnings");
    expect(readLayer(KML, "x.kml").format).toBe("kml");
  });

  it("refuses error pages and empty or broken files", () => {
    expect(() => readLayer("<!DOCTYPE html><html><head><title>404</title></head></html>")).toThrow("not-a-layer");
    expect(() => readLayer("just some text")).toThrow("not-a-layer");
    expect(() => readLayer('{"type":"FeatureCollection","features":[]}')).toThrow("not-a-layer");
    expect(() => readLayer("{ broken json")).toThrow("unreadable");
  });
});
