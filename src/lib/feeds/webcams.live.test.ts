// Temporary: looks for a field in Iowa DOT's camera layer that marks offline cameras. Removed after use.
import { describe, it } from "vitest";

const BASE = "https://services.arcgis.com/8lRhdTsQyJpO52F1/arcgis/rest/services/Traffic_Cameras_View/FeatureServer/0";
const mask = (v: unknown) => String(v).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "<email>").replace(/\+?\d[\d\s().-]{8,}\d/g, "<num>").slice(0, 60);

describe.runIf(process.env.LIVE_CAMS === "1")("live Iowa DOT layer fields", () => {
  it("finds an offline marker", async () => {
    const meta = await (await fetch(`${BASE}?f=json`)).json();
    console.log("fields:", meta.fields.map((f: { name: string; type: string }) => `${f.name}:${f.type.replace("esriFieldType", "")}`).join(", "));
    const rows: Record<string, unknown>[] = [];
    for (let off = 0; ; off += 2000) {
      const j = await (await fetch(`${BASE}/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=2000&resultOffset=${off}&f=json`)).json();
      rows.push(...j.features.map((f: { attributes: Record<string, unknown> }) => f.attributes));
      if (!j.exceededTransferLimit) break;
    }
    const iadot = rows.filter((r) => r.ORG === "IADOT" && typeof r.ImageURL === "string");
    console.log(`rows ${rows.length}, IADOT with image ${iadot.length}`);
    const status = await Promise.all(iadot.filter((_, i) => i % 8 === 0).map(async (r) => {
      try { const res = await fetch(String(r.ImageURL), { signal: AbortSignal.timeout(20_000) }); await res.arrayBuffer(); return { r, ok: res.ok }; }
      catch { return { r, ok: false }; }
    }));
    console.log(`sampled ${status.length}, loading ${status.filter((s) => s.ok).length}`);
    for (const f of meta.fields as { name: string }[]) {
      const values = new Set(iadot.map((r) => r[f.name]));
      if (values.size > 12) continue;
      const byValue = [...values].map((v) => {
        const s = status.filter((x) => x.r[f.name] === v);
        return `${mask(v)}=${iadot.filter((r) => r[f.name] === v).length} (${s.filter((x) => x.ok).length}/${s.length} load)`;
      });
      console.log(`${f.name}: ${byValue.join(" | ")}`);
    }
    // Date-like fields: does an old timestamp predict a dead image?
    for (const f of meta.fields as { name: string; type: string }[]) {
      if (!/Date/.test(f.type)) continue;
      const age = (x: { r: Record<string, unknown> }) => (Date.now() - Number(x.r[f.name])) / 86_400_000;
      const dead = status.filter((x) => !x.ok).map(age).sort((a, b) => a - b);
      const live = status.filter((x) => x.ok).map(age).sort((a, b) => a - b);
      console.log(`${f.name} age days: dead median ${dead[dead.length >> 1]?.toFixed(1)}, live median ${live[live.length >> 1]?.toFixed(1)}`);
    }
  }, 180_000);
});
