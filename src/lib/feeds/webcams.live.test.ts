// Temporary: runs the Iowa DOT and WSDOT parsers against the live layers from a CI runner. Removed after use.
import { describe, expect, it } from "vitest";
import { toWebcam, webcamImage } from "../webcams";
import { loadWebcamSource } from "./webcams";

describe.runIf(process.env.LIVE_CAMS === "1")("live state DOT cameras", () => {
  for (const id of ["iowa", "wsdot"] as const) {
    it(`${id}: parses the live layer and its images load`, async () => {
      const rows = await loadWebcamSource(id);
      console.log(`${id}: ${rows.length} cameras; first: ${JSON.stringify(rows.slice(0, 3))}`);
      const keys = new Set(rows.map((r) => r[1]));
      console.log(`${id}: unique keys ${keys.size}; lat range ${Math.min(...rows.map((r) => r[2]))}..${Math.max(...rows.map((r) => r[2]))}; lon range ${Math.min(...rows.map((r) => r[3]))}..${Math.max(...rows.map((r) => r[3]))}`);
      expect(rows.length).toBeGreaterThan(100);
      for (const row of [rows[0]!, rows[Math.floor(rows.length / 2)]!, rows.at(-1)!]) {
        const url = webcamImage(toWebcam(row));
        const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        const bytes = (await res.arrayBuffer()).byteLength;
        console.log(`  ${res.status} ${res.headers.get("content-type")} ${bytes}B ${url}`);
        expect(res.ok).toBe(true);
      }
    }, 120_000);
  }
});
