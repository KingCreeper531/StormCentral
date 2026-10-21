// Temporary: checks which Iowa DOT image folders actually serve pictures, from a CI runner. Removed after use.
import { describe, it } from "vitest";
import { toWebcam, webcamImage } from "../webcams";
import { loadWebcamSource } from "./webcams";

describe.runIf(process.env.LIVE_CAMS === "1")("live Iowa DOT image folders", () => {
  it("samples each folder", async () => {
    const rows = await loadWebcamSource("iowa");
    const byFolder = new Map<string, typeof rows>();
    for (const r of rows) byFolder.set(r[1].split("/")[0]!, [...(byFolder.get(r[1].split("/")[0]!) ?? []), r]);
    for (const [folder, list] of byFolder) {
      const sample = list.filter((_, i) => i % Math.max(1, Math.floor(list.length / 12)) === 0).slice(0, 12);
      const results = await Promise.all(sample.map(async (r) => {
        try {
          const res = await fetch(webcamImage(toWebcam(r)), { signal: AbortSignal.timeout(20_000) });
          const age = res.headers.get("last-modified");
          await res.arrayBuffer();
          return `${res.status}${age ? ` (${Math.round((Date.now() - Date.parse(age)) / 60000)} min old)` : ""}`;
        } catch (e) { return `ERR ${(e as Error).message}`; }
      }));
      const ok = results.filter((s) => s.startsWith("200")).length;
      console.log(`${folder}: ${list.length} cameras; sample ${ok}/${sample.length} load → ${results.join(", ")}; e.g. ${sample[0]?.[1]} "${sample[0]?.[4]}"`);
    }
  }, 180_000);
});
