// Temporary: checks the format of Iowa DOT's UpdateDate/UpdateTime against the images' Last-Modified. Removed after use.
import { describe, it } from "vitest";

const BASE = "https://services.arcgis.com/8lRhdTsQyJpO52F1/arcgis/rest/services/Traffic_Cameras_View/FeatureServer/0";

describe.runIf(process.env.LIVE_CAMS === "1")("live Iowa DOT update time", () => {
  it("compares UpdateTime with Last-Modified", async () => {
    const j = await (await fetch(`${BASE}/query?where=1%3D1&outFields=UpdateDate,UpdateTime,UTCoffset,ImageURL&returnGeometry=false&f=json`)).json();
    const rows = (j.features as { attributes: Record<string, number | string> }[]).map((f) => f.attributes);
    const times = rows.map((r) => Number(r.UpdateTime)).sort((a, b) => a - b);
    console.log(`now ${new Date().toISOString()}; UpdateTime min ${times[0]} max ${times[times.length - 1]}; values > 2359: ${times.filter((t) => t > 2359).length}/${times.length}`);
    for (const r of rows.filter((_, i) => i % 90 === 0)) {
      const res = await fetch(String(r.ImageURL), { signal: AbortSignal.timeout(20_000) }).catch(() => null);
      await res?.arrayBuffer();
      console.log(`${r.UpdateDate} ${r.UpdateTime} ${r.UTCoffset} → image ${res?.status} last-modified ${res?.headers.get("last-modified")}`);
    }
  }, 120_000);
});
